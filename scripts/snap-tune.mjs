// Yola oturtma ayar denemesi: gerçek kayıttaki parçaları sunucunun eşleştirme koduyla (server/server.js)
// farklı ayarlarla oturtur, parça başına ölçüleri yan yana yazar. OSRM motorlarına SSH tüneliyle bağlanır:
//   ssh -N -L 13701:127.0.0.1:3701 -L 13702:127.0.0.1:3702 root@80.240.17.26
//   node scripts/snap-tune.mjs veri/iz-veri-2026-9-30.csv
// Ölçüler: d = yol uzunluğu (yerel düzeltmeye oranı), kap = eşleşen nokta oranı, bş = kesikli boşluk,
//          dön = geri dönüş (U) sayısı — yolda gidip aynı yoldan geri gelen "diken" hatası
import fs from 'fs';
import { analyze, dayStart, addDays } from '../src/engine.js';
import { snapCandidates } from '../src/snapcore.js';

process.env.OSRM_FOOT = 'http://127.0.0.1:13701';
process.env.OSRM_CAR = 'http://127.0.0.1:13702';
const { matchLeg, PROF, hav } = (await import('../server/server.js')).default;

const src = process.argv[2];
const points = [], acts = [];
for (const l of fs.readFileSync(src, 'utf8').split(/\r?\n/)) {
  const f = l.split(','), num = (v) => (v === '' || v == null ? null : +v);
  if (f[0] === 'P' && f[1] !== 't') points.push({ t: +f[1], lat: +f[2], lon: +f[3], acc: num(f[4]), spd: num(f[5]), crs: num(f[6]) });
  if (f[0] === 'A' && f[1] !== 't') acts.push({ t: +f[1], k: f[2], c: +f[3] });
}
const R = analyze(points, { from: dayStart(points[0].t), to: addDays(dayStart(points[points.length - 1].t), 1), acts });
const legs = R.items.flatMap((x) => (x.type === 'trip' ? x.legs : []));
const todo = snapCandidates(R.items, Date.now(), () => false);

// Geri dönüş sayısı: ardışık iki parçanın yönü 150°'den fazla dönüyorsa (kısa parçalar birleştirilerek)
function uturns(c) {
  const v = [c[0]];
  for (const q of c) if (hav(v[v.length - 1], q) >= 8) v.push(q);
  const brg = (a, b) => Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]);
  let n = 0;
  for (let i = 1; i < v.length - 1; i++) {
    let d = Math.abs(brg(v[i - 1], v[i]) - brg(v[i], v[i + 1]));
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > (150 * Math.PI) / 180) n++;
  }
  return n;
}

const base = JSON.parse(JSON.stringify(PROF));
const VARIANTS = {
  temel: {},
  'acc-süzgeç-yok': { walk: { maxAcc: 100 }, car: { maxAcc: 100 }, bus: { maxAcc: 100 } },
  'yaya-rMin8': { walk: { rMin: 8 } },
  'yaya-rMin20': { walk: { rMin: 20 } },
  'yaya-rMin30': { walk: { rMin: 30, rMax: 50 } },
  'araç-gaps-ignore': { car: { gaps: 'ignore' }, bus: { gaps: 'ignore' } },
  'yaya-gaps-ignore': { walk: { gaps: 'ignore' } },
};
const hm = (t) => new Date(t).toTimeString().slice(0, 5);
for (const [name, v] of Object.entries(VARIANTS)) {
  for (const m of Object.keys(PROF)) Object.assign(PROF[m], base[m], v[m] || {});
  const cells = [];
  for (const x of todo) {
    const r = await matchLeg(x.leg), [, mode, a] = x.k.split(':'), leg = legs.find((l) => String(l.t0) === a && l.mode === mode);
    if (!r.ok) { cells.push(`${hm(+a)} ${mode}: ✗ ${r.why}`); continue; }
    const turns = r.parts.filter((p) => !p.g).reduce((s, p) => s + uturns(p.c), 0);
    cells.push(`${hm(+a)} ${mode}: ${r.d}m (${(r.d / leg.dist).toFixed(2)}) kap ${r.cover} bş ${r.parts.filter((p) => p.g).length} dön ${turns}`);
  }
  console.log('== ' + name + '\n  ' + cells.join('\n  '));
}
