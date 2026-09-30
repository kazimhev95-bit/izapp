// Telefondan dışa aktarılan iz-veri CSV dosyasını web önizlemesinin okuyacağı JSON'a çevirir.
//   node scripts/csv2json.js veri/iz-veri-2026-9-30.csv dist/veri.json
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const points = [], acts = [];
for (const l of fs.readFileSync(src, 'utf8').split(/\r?\n/)) {
  const f = l.split(',');
  const num = (v) => (v === '' || v == null ? null : +v);
  if (f[0] === 'P' && f[1] !== 't') points.push({ t: +f[1], lat: +f[2], lon: +f[3], acc: num(f[4]), spd: num(f[5]), crs: num(f[6]) });
  if (f[0] === 'A' && f[1] !== 't') acts.push({ t: +f[1], k: f[2], c: +f[3] });
}
fs.writeFileSync(dst, JSON.stringify({ points, acts }));
console.log('nokta', points.length, 'hareket', acts.length, '→', dst);
