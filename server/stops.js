'use strict';
// OSM otobüs duraklarını telefona gidecek küçük listeye çevirir (build.sh çağırır).
//   node stops.js <osmium geojsonseq> <çıktı.json>
// Girdi: osmium ile süzülmüş highway=bus_stop / public_transport=platform|stop_position noktaları.
// Aynı durağın "platform" ve "stop_position" noktaları çoğu zaman 5-20 m arayla ikisi birden çizilmiştir:
// 20 m içindekiler tek durak sayılır. Çıktı: {v: tarih, n, pts: [[lat, lon], ...]} (5 ondalık ≈ 1 m)
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const pts = [];
for (let line of fs.readFileSync(src, 'utf8').split('\n')) {
  line = line.replace(/^\x1e/, '').trim();
  if (!line) continue;
  const f = JSON.parse(line);
  if (!f.geometry || f.geometry.type !== 'Point') continue;
  const [lon, lat] = f.geometry.coordinates;
  pts.push([lat, lon]);
}
// 20 m içindekileri birleştir (ızgara: ~0,0005° hücre, komşu hücrelere de bakılır)
const M = 111320, cell = 0.0005, grid = new Map(), out = [];
const key = (a, b) => a + ':' + b;
for (const [lat, lon] of pts) {
  const gy = Math.floor(lat / cell), gx = Math.floor(lon / cell);
  let dup = false;
  for (let dy = -1; dy <= 1 && !dup; dy++) for (let dx = -1; dx <= 1 && !dup; dx++) {
    for (const q of grid.get(key(gy + dy, gx + dx)) || []) {
      if (Math.hypot((q[0] - lat) * M, (q[1] - lon) * M * Math.cos(lat * Math.PI / 180)) <= 20) { dup = true; break; }
    }
  }
  if (dup) continue;
  const p = [+lat.toFixed(5), +lon.toFixed(5)];
  out.push(p);
  const k = key(gy, gx);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(p);
}
const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
fs.writeFileSync(dst, JSON.stringify({ v: String(d.getFullYear()).slice(2) + p2(d.getMonth() + 1) + p2(d.getDate()), n: out.length, pts: out }));
console.log('otobüs durağı:', pts.length, 'nokta →', out.length, 'durak →', dst);
