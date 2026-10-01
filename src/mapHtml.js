// Harita sayfası (Leaflet + OpenStreetMap, açık yumuşak ton). Telefonda WebView, önizlemede iframe
// içinde AYNI sayfa çalışır — önizlemede ne görünüyorsa telefonda da o görünür.
// Gelen:  izSet({legs, stays, marks, dots, rings, fit, pad}) — rota ve katmanlar
//         izMe({mePos, acc, center, follow}) — canlı konum;  izCur({pos, label}) — hız grafiğinde seçilen an
//   legs: [{pts, color, w, dash, op (saydamlık), arrows (yön okları), info (dokununca çıkan satırlar), trip}]
//   marks: olay noktaları (araçtan indi/bindi, bekleme) — dokununca saat ve açıklama çıkar
//   dots: kayıt noktaları [lat, lon, renk];  rings: doğruluk halkaları [lat, lon, metre]
// Giden:  {ready}, {stay: key} durağa dokunma, {trip: key} "Ayrıntılar", {drag: 1} elle kaydırma
export const MAP_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html,body,#m{margin:0;height:100%;background:#F4F5F7}
  /* açık, yumuşak ton: renkler soluklaştırılır (parklar açık yeşil, su açık mavi, yollar beyaz-gri) */
  .bw{filter:saturate(.55) brightness(1.06) contrast(.94)}
  .leaflet-control-attribution{background:rgba(255,255,255,.75)!important;color:#5B6873!important;font-size:9px}
  .leaflet-control-attribution a{color:#5B6873!important}
  #off{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#5B6873;font:14px -apple-system,sans-serif;text-align:center;padding:30px}
  /* parça bilgisi kutusu */
  .leaflet-popup-content{margin:9px 11px;font:12px/1.45 -apple-system,sans-serif;color:#111820}
  .pi b{font-size:13px}.pi .d{color:#5B6873}.pi .w{color:#BF8700}
  .pi a{display:inline-block;margin-top:5px;color:#0A84A8;font-weight:600;text-decoration:none}
  .cur{background:#111820;color:#fff;border:0;border-radius:6px;font:11px -apple-system,sans-serif;padding:3px 6px;box-shadow:none}
  .cur:before{display:none}
</style></head>
<body><div id="m"></div><div id="off">Harita yüklenemedi.<br>İnternet bağlantısını kontrol et.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  function send(o){var s=JSON.stringify(o);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else parent.postMessage(s,'*');}
  if(!window.L){document.getElementById('off').style.display='flex';}
  else{
    // canvas: binlerce noktalı rota telefonu yormaz; tolerance: ince çizgiye parmakla dokunmak kolay olsun
    var map=L.map('m',{zoomControl:false,preferCanvas:true,renderer:L.canvas({tolerance:12})}).setView([40.4093,49.8671],12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,className:'bw',attribution:'© OpenStreetMap'}).addTo(map);
    map.attributionControl.setPrefix(false); // Leaflet'in kendi logo/bayrak ön eki gösterilmez
    var g=L.layerGroup().addTo(map), ar=L.layerGroup().addTo(map), legsNow=[];

    // Bilgi kutusu: satırlar metin olarak eklenir (HTML değil — yer adları güvenle gösterilsin).
    // İlk satır kalın; "!" ile başlayan satır uyarı renginde. trip verilirse "Ayrıntılar ›" bağlantısı.
    function pop(latlng,lines,trip){
      var el=document.createElement('div');el.className='pi';
      (lines||[]).forEach(function(t,i){var r=document.createElement(i?'div':'b');if(i&&t.charAt(0)==='!'){r.className='w';t=t.slice(1);}else if(i)r.className='d';r.textContent=t;el.appendChild(r);if(!i)el.appendChild(document.createElement('br'));});
      if(trip!=null){var a=document.createElement('a');a.href='#';a.textContent='Ayrıntılar ›';a.onclick=function(e){e.preventDefault();map.closePopup();send({trip:trip});};el.appendChild(a);}
      L.popup({closeButton:false,autoPan:true,maxWidth:260}).setLatLng(latlng).setContent(el).openOn(map);
    }

    // Yön okları: çizgi boyunca ekranda ~90 piksel arayla beyaz "›" — gidiş/dönüş aynı yoldan geçse de yön belli olsun.
    // Ekran pikseliyle hesaplandığı için yakınlaştırınca yeniden çizilir (boyları hep aynı kalır).
    function drawArrows(){
      ar.clearLayers();
      if(map.getZoom()<12)return; // uzaktan bakınca oklar seçilmez; 30 günlük haritada telefonu yormasın
      var vb=map.getBounds().pad(0.2);
      legsNow.forEach(function(l){
        if(!l.arrows||l.pts.length<2)return;
        if(!vb.intersects(L.latLngBounds(l.pts)))return; // yalnız ekranda görünen çizgiler
        var P=l.pts.map(function(q){return map.latLngToLayerPoint(q);}), next=45;
        for(var i=1,acc=0;i<P.length;i++){
          var a=P[i-1],b=P[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.sqrt(dx*dx+dy*dy);
          if(!len)continue;
          var ux=dx/len,uy=dy/len;
          while(acc+len>=next){
            var t=next-acc,cx=a.x+ux*t,cy=a.y+uy*t,nx=-uy,ny=ux;
            var ll=[L.point(cx-5*ux+4*nx,cy-5*uy+4*ny),L.point(cx+3*ux,cy+3*uy),L.point(cx-5*ux-4*nx,cy-5*uy-4*ny)].map(function(p){return map.layerPointToLatLng(p);});
            L.polyline(ll,{color:'#FFFFFF',weight:2.2,opacity:.95,lineCap:'round',lineJoin:'round',interactive:false}).addTo(ar);
            next+=90;
          }
          acc+=len;
        }
      });
    }
    map.on('zoomend moveend',drawArrows);

    // Canlı konum noktası: rota katmanından ayrı durur, her konum güncellemesinde yalnız o kayar.
    var meM=null,meA=null;
    window.izMe=function(d){
      if(d.clear){if(meM){map.removeLayer(meM);map.removeLayer(meA);meM=null;meA=null;}return;} // başka güne bakılıyor: noktayı kaldır
      var p=d.mePos;
      if(!meM){
        meA=L.circle(p,{radius:d.acc||0,color:'#2E7CF6',weight:0,fillColor:'#2E7CF6',fillOpacity:.12,interactive:false}).addTo(map);
        meM=L.circleMarker(p,{radius:7,color:'#fff',weight:3,fillColor:'#2E7CF6',fillOpacity:1,interactive:false}).addTo(map);
      }else{meM.setLatLng(p);meA.setLatLng(p);meA.setRadius(d.acc||0);}
      meM.bringToFront();
      if(d.center)map.setView(p,Math.max(map.getZoom(),16));
      else if(d.follow)map.panTo(p,{animate:true,duration:0.5}); // takip: harita konumla birlikte kayar
    };
    // Hız grafiğinde seçilen an: koyu nokta + saat/hız etiketi; harita o noktayı görünür tutar
    var curM=null;
    window.izCur=function(d){
      if(!d.pos){if(curM){map.removeLayer(curM);curM=null;}return;}
      if(!curM)curM=L.circleMarker(d.pos,{radius:7,color:'#fff',weight:3,fillColor:'#111820',fillOpacity:1,interactive:false}).addTo(map);
      else curM.setLatLng(d.pos);
      curM.unbindTooltip();curM.bindTooltip(d.label||'',{permanent:true,direction:'top',offset:[0,-8],className:'cur'}).openTooltip();
      if(!map.getBounds().pad(-0.1).contains(d.pos))map.panTo(d.pos,{animate:true,duration:0.3});
    };
    // Kullanıcı haritayı eliyle kaydırırsa takip bırakılır (uygulamaya haber ver).
    map.on('dragstart',function(){send({drag:1});});

    window.izSet=function(d){
      g.clearLayers();
      var all=[];
      // Doğruluk halkaları: her kayıt noktasının "telefon ±X m dedi" alanı (en altta, çok soluk)
      (d.rings||[]).forEach(function(r){
        L.circle([r[0],r[1]],{radius:r[2],color:'#8A97A3',weight:.6,opacity:.5,fillColor:'#8A97A3',fillOpacity:.05,interactive:false}).addTo(g);
      });
      legsNow=d.legs;
      d.legs.forEach(function(l){
        // smoothFactor 0: Leaflet ayrıca sadeleştirmesin (düzeltme + sadeleştirme uygulamada yapıldı)
        var pl=L.polyline(l.pts,{color:l.color,weight:l.w,opacity:l.op||1,lineCap:'round',lineJoin:'round',smoothFactor:0,dashArray:l.dash?(l.w<4?'6 6':'8 8'):null,interactive:!!l.info}).addTo(g);
        if(l.info)pl.on('click',function(e){pop(e.latlng,l.info,l.trip);});
        all=all.concat(l.pts);
      });
      // Kayıt noktaları ("boncuklar"): GPS'in gerçekten ölçtüğü yerler — beyaz, halkası parçanın renginde.
      // Zayıf nokta (±25 m'den kötü) küçük ve soluk: sapan ölçüm göze batmasın ama gizlenmesin.
      (d.dots||[]).forEach(function(p){
        var w=p[3]===1;
        L.circleMarker([p[0],p[1]],{radius:w?1.8:2.6,color:p[2]||'#5B6873',weight:w?1:1.3,opacity:w?.35:1,fillColor:'#FFFFFF',fillOpacity:w?.35:1,interactive:false}).addTo(g);
      });
      // Olay noktaları: bekleme = gri halka; araç değişimi = koyu halka, içi yeni türün renginde
      (d.marks||[]).forEach(function(m){
        var w=m.k==='wait';
        L.circleMarker([m.lat,m.lon],{radius:w?5:6,color:w?'#5B6873':'#111820',weight:w?2:2.5,fillColor:w?'#FFFFFF':m.c,fillOpacity:1})
          .on('click',function(e){pop(e.latlng,[m.t],null);}).addTo(g);
      });
      d.stays.forEach(function(s){
        L.circleMarker([s.lat,s.lon],{radius:9,color:'#0A84A8',weight:3,fillColor:'#FFFFFF',fillOpacity:1}).on('click',function(){send({stay:s.key});}).addTo(g);
        all.push([s.lat,s.lon]);
      });
      if(d.fit&&all.length){map.invalidateSize();map.fitBounds(all,{paddingTopLeft:[d.pad.left,d.pad.top],paddingBottomRight:[d.pad.right,d.pad.bottom],maxZoom:17});}
      drawArrows();
    };
    window.addEventListener('message',function(e){try{var d=JSON.parse(e.data);if(d&&d.legs)window.izSet(d);else if(d&&d.cur)window.izCur(d.cur);else if(d&&(d.mePos||d.clear))window.izMe(d);}catch(x){}});
    send({ready:1});
  }
</script></body></html>`;

// Uygulama verisini harita sayfasının beklediği yalın biçime çevirir.
//   legs: [{mode, dash, coords, info?, trip?, weak?}] — mode 'raw' (ince gri) ve 'track' (turuncu gerçek iz) katmandır
export function mapPayload({ legs, stays, marks, dots, rings, pad }, colors, fit) {
  const W = { raw: 2, track: 3 };
  const L = legs.map((l) => ({
    color: colors[l.mode].color, dash: !!l.dash || l.mode === 'track', w: W[l.mode] || 5,
    op: l.weak ? 0.55 : l.mode === 'track' ? 0.9 : 1,   // GPS'i zayıf parça soluk: "burası yaklaşık"
    arrows: !W[l.mode] && !l.dash,                      // yön okları yalnız asıl çizgide
    info: l.info || null, trip: l.trip == null ? null : l.trip,
    pts: l.coords.map((c) => [c.latitude, c.longitude]),
  }));
  return {
    legs: L, stays: stays.map((s) => ({ key: s.key, lat: s.lat, lon: s.lon })),
    marks: (marks || []).map((m) => ({ k: m.kind, lat: m.lat, lon: m.lon, t: m.label, c: m.mode ? colors[m.mode].color : null })),
    dots: (dots || []).map((q) => [q.lat, q.lon, q.mode ? colors[q.mode].color : null, q.weak ? 1 : 0]),
    rings: (rings || []).map((q) => [q.lat, q.lon, q.acc]),
    fit, pad: pad || { top: 120, right: 50, bottom: 260, left: 50 },
  };
}
