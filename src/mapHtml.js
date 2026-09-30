// Harita sayfası (Leaflet + OpenStreetMap, açık yumuşak ton). Telefonda WebView, önizlemede iframe
// içinde AYNI sayfa çalışır — önizlemede ne görünüyorsa telefonda da o görünür.
// Veri dışarıdan izSet({legs, stays, me, fit, pad}) ile gelir; durağa dokunma {stay: key} olarak döner.
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
    var g=L.layerGroup().addTo(map);
    window.izSet=function(d){
      g.clearLayers();
      var all=[];
      d.legs.forEach(function(l){
        // smoothFactor 0: çizgi sadeleştirilmez, kaydedilen her nokta aynen çizilir
        L.polyline(l.pts,{color:l.color,weight:5,lineCap:'round',lineJoin:'round',smoothFactor:0,dashArray:l.dash?'8 8':null}).addTo(g);
        all=all.concat(l.pts);
      });
      d.stays.forEach(function(s){
        L.circleMarker([s.lat,s.lon],{radius:9,color:'#0A84A8',weight:3,fillColor:'#FFFFFF',fillOpacity:1}).on('click',function(){send({stay:s.key});}).addTo(g);
        all.push([s.lat,s.lon]);
      });
      if(d.me)L.circleMarker(d.me,{radius:6,color:'#fff',weight:2,fillColor:'#2E7CF6',fillOpacity:1}).addTo(g);
      if(d.fit&&all.length){map.invalidateSize();map.fitBounds(all,{paddingTopLeft:[d.pad.left,d.pad.top],paddingBottomRight:[d.pad.right,d.pad.bottom],maxZoom:17});}
    };
    window.addEventListener('message',function(e){try{var d=JSON.parse(e.data);if(d&&d.legs)window.izSet(d);}catch(x){}});
    send({ready:1});
  }
</script></body></html>`;

// Uygulama verisini harita sayfasının beklediği yalın biçime çevirir.
export function mapPayload({ legs, stays, live, pad }, colors, fit) {
  const L = legs.map((l) => ({ color: colors[l.mode].color, dash: l.mode === 'metro', pts: l.coords.map((c) => [c.latitude, c.longitude]) }));
  const last = L.length ? L[L.length - 1].pts : [];
  return {
    legs: L, stays: stays.map((s) => ({ key: s.key, lat: s.lat, lon: s.lon })),
    me: live && last.length ? last[last.length - 1] : null, // bugünse: son kaydedilen konum
    fit, pad: pad || { top: 120, right: 50, bottom: 260, left: 50 },
  };
}
