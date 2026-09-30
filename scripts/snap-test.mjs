// Yola oturtma sahası testi: gerçek kayıttaki (telefondan dışa aktarılan CSV) yolculuk parçalarını
// kendi sunucumuza sorar ve parça parça sonucu yazar.
//   node scripts/snap-test.mjs veri/iz-veri-2026-9-30.csv [çıktı.json]
// Anahtar: .env içindeki EXPO_PUBLIC_IZ_KEY (uygulamanın kullandığıyla aynı).
import fs from 'fs';
import { analyze, dayStart, addDays } from '../src/engine.js';
import { snapCandidates } from '../src/snapcore.js';

const [src, outFile] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const KEY = env.EXPO_PUBLIC_IZ_KEY, URL_ = 'https://iz.80-240-17-26.sslip.io/v1/match';

// CSV -> noktalar + hareket kayıtları (scripts/csv2json.js ile aynı biçim)
const points = [], acts = [];
for (const l of fs.readFileSync(src, 'utf8').split(/\r?\n/)) {
  const f = l.split(','), num = (v) => (v === '' || v == null ? null : +v);
  if (f[0] === 'P' && f[1] !== 't') points.push({ t: +f[1], lat: +f[2], lon: +f[3], acc: num(f[4]), spd: num(f[5]), crs: num(f[6]) });
  if (f[0] === 'A' && f[1] !== 't') acts.push({ t: +f[1], k: f[2], c: +f[3] });
}
const from = dayStart(points[0].t), to = addDays(dayStart(points[points.length - 1].t), 1);
const R = analyze(points, { from, to, acts });
const todo = snapCandidates(R.items, Date.now(), () => false);
console.log('nokta', points.length, '· yolculuk', R.items.filter((x) => x.type === 'trip').length, '· sorulacak parça', todo.length);

const t0 = Date.now();
const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-iz-key': KEY }, body: JSON.stringify({ legs: todo.map((x) => x.leg) }) });
const j = await res.json();
console.log('HTTP', res.status, '·', Date.now() - t0, 'ms · gövde', (JSON.stringify({ legs: todo.map((x) => x.leg) }).length / 1024).toFixed(1), 'KB');
const hm = (t) => new Date(t).toTimeString().slice(0, 5);
for (const r of j.legs || []) {
  const [, mode, a, b, n] = r.id.split(':');
  const leg = R.items.flatMap((x) => (x.type === 'trip' ? x.legs : [])).find((l) => String(l.t0) === a && l.mode === mode);
  const line = `${hm(+a)}-${hm(+b)} ${mode.padEnd(4)} ${n.padStart(4)} nokta · yerel ${Math.round(leg.dist)} m`;
  console.log(r.ok ? `${line} → yol ${r.d} m (kapsama ${r.cover}, ${r.parts.length} çizgi, ${r.parts.filter((p) => p.g).length} boşluk)` : `${line} → OTURMADI: ${r.why}${r.d ? ' ' + r.d + '/' + r.raw : ''}`);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(j));
