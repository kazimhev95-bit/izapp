// Harita sayfası (Leaflet + OpenStreetMap, açık yumuşak ton). Telefonda WebView, önizlemede iframe
// içinde AYNI sayfa çalışır — önizlemede ne görünüyorsa telefonda da o görünür.
// Veri dışarıdan izSet({legs, stays, fit, pad}) ile, canlı konum izMe({mePos, acc, center}) ile gelir;
// durağa dokunma {stay: key} olarak döner.
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
</style></head>
<body><div id="m"></div><div id="off">Harita yüklenemedi.<br>İnternet bağlantısını kontrol et.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  function send(o){var s=JSON.stringify(o);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else parent.postMessage(s,'*');}
  if(!window.L){document.getElementById('off').style.display='flex';}
  else{
    var map=L.map('m',{zoomControl:false,preferCanvas:true}) /* canvas: binlerce noktalı rota telefonu yormaz */.setView([40.4093,49.8671],12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,className:'bw',attribution:'© OpenStreetMap'}).addTo(map);
    map.attributionControl.setPrefix(false); // Leaflet'in kendi logo/bayrak ön eki gösterilmez
    var g=L.layerGroup().addTo(map);
    // Canlı konum noktası: rota katmanından ayrı durur, her konum güncellemesinde yalnız o kayar.
    var meM=null,meA=null;
    window.izMe=function(d){
      var p=d.mePos;
      if(!meM){
        meA=L.circle(p,{radius:d.acc||0,color:'#2E7CF6',weight:0,fillColor:'#2E7CF6',fillOpacity:.12,interactive:false}).addTo(map);
        meM=L.circleMarker(p,{radius:7,color:'#fff',weight:3,fillColor:'#2E7CF6',fillOpacity:1,interactive:false}).addTo(map);
      }else{meM.setLatLng(p);meA.setLatLng(p);meA.setRadius(d.acc||0);}
      meM.bringToFront();
      if(d.center)map.setView(p,Math.max(map.getZoom(),16));
    };
    window.izSet=function(d){
      g.clearLayers();
      var all=[];
      d.legs.forEach(function(l){
        // smoothFactor 0: çizgi sadeleştirilmez, kaydedilen her nokta aynen çizilir
        L.polyline(l.pts,{color:l.color,weight:l.w,lineCap:'round',lineJoin:'round',smoothFactor:0,dashArray:l.dash?'8 8':null}).addTo(g);
        all=all.concat(l.pts);
      });
      d.stays.forEach(function(s){
        L.circleMarker([s.lat,s.lon],{radius:9,color:'#0A84A8',weight:3,fillColor:'#FFFFFF',fillOpacity:1}).on('click',function(){send({stay:s.key});}).addTo(g);
        all.push([s.lat,s.lon]);
      });
      if(d.fit&&all.length){map.invalidateSize();map.fitBounds(all,{paddingTopLeft:[d.pad.left,d.pad.top],paddingBottomRight:[d.pad.right,d.pad.bottom],maxZoom:17});}
    };
    window.addEventListener('message',function(e){try{var d=JSON.parse(e.data);if(d&&d.legs)window.izSet(d);else if(d&&d.mePos)window.izMe(d);}catch(x){}});
    send({ready:1});
  }
</script></body></html>`;

// Uygulama verisini harita sayfasının beklediği yalın biçime çevirir.
export function mapPayload({ legs, stays, pad }, colors, fit) {
  const L = legs.map((l) => ({ color: colors[l.mode].color, dash: !!l.dash, w: l.mode === 'raw' ? 2 : 5, pts: l.coords.map((c) => [c.latitude, c.longitude]) }));
  return {
    legs: L, stays: stays.map((s) => ({ key: s.key, lat: s.lat, lon: s.lon })),
    fit, pad: pad || { top: 120, right: 50, bottom: 260, left: 50 },
  };
}
