// Motor testi: sentetik 14 günlük veride beklenen sonuçlar çıkıyor mu?  ->  node test/engine.test.mjs
import { analyze, dayStart, addDays } from '../src/engine.js';
import { demoPoints } from '../src/demo.js';

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'OK   ' : 'FAIL ') + msg); if (!c) fail++; };
const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

// Sabit bitiş: 30 Eyl 2026 Çarşamba 23:00 (yerel)
const END = new Date(2026, 8, 30, 23, 0).getTime();
const pts = demoPoints(END, 14);
console.log('nokta:', pts.length);

// --- 14 günlük analiz (ev/iş tespiti + rutin) ---
const from = addDays(dayStart(END), -13), to = addDays(dayStart(END), 1);
const R = analyze(pts, { from, to, detect: true });
const home = R.places.find((p) => p.kind === 'home'), work = R.places.find((p) => p.kind === 'work');
ok(!!home, 'ev bulundu');
ok(!!work, 'iş bulundu');
ok(home && Math.abs(home.lat - 40.4093) < 0.001, 'ev konumu doğru');
ok(work && Math.abs(work.lat - 40.3745) < 0.001, 'iş konumu doğru');
ok(R.places.length >= 3 && R.places.length <= 6, 'yer sayısı makul: ' + R.places.length);
console.log(R.places.map((p) => `${p.name} ${(p.total / 3600e3).toFixed(1)}sa ${p.visits}x`).join(' | '));

const m = R.totals.modes;
console.log(Object.entries(m).map(([k, v]) => `${k} ${(v.dist / 1000).toFixed(1)}km ${(v.dur / 60e3).toFixed(0)}dk`).join(' | '));
ok(m.metro.dist > 50000, 'metro tespit edildi');
ok(m.car.dist > 15000, 'araba tespit edildi');
ok(m.walk.dist > 5000, 'yaya tespit edildi');
ok(m.bike.dist < 500, 'yanlış bisiklet yok');

const hw = R.routines.find((r) => r.from === home && r.to === work);
ok(!!hw, 'Ev→İş rutini var');
if (hw) {
  console.log(`Ev→İş ${hw.count}x çıkış ${hm(hw.dep.min)}–${hm(hw.dep.max)} varış ${hm(hw.arr.min)}–${hm(hw.arr.max)} yol ${(hw.dur.avg / 60e3).toFixed(0)}dk tür ${hw.mode}`);
  ok(hw.count === 10, '10 iş günü yolculuğu');
  ok(hw.dep.min >= 8 * 60 && hw.dep.max <= 8 * 60 + 50, 'çıkış 08:00–08:50 arası');
  ok(hw.dur.avg > 20 * 60e3 && hw.dur.avg < 45 * 60e3, 'yol süresi 20–45 dk');
  ok(hw.mode === 'metro', 'ana tür metro');
}
ok(R.routines.some((r) => r.from === work && r.to === home), 'İş→Ev rutini var');

// --- Tek gün (Çarşamba): ev → iş → ev ---
const D = analyze(pts, { from: dayStart(END), to: addDays(dayStart(END), 1), hints: { home, work } });
const seq = D.items.map((i) => (i.type === 'stay' ? i.place.name : i.type === 'trip' ? i.mode : 'gap')).join(' > ');
console.log(seq);
ok(seq === 'Ev > metro > İş > metro > Ev', 'günlük sıra doğru');
const trip = D.items.find((i) => i.type === 'trip');
ok(trip.legs.map((l) => l.mode).join(',') === 'walk,metro,walk', 'parçalar: yürü,metro,yürü -> ' + trip.legs.map((l) => l.mode).join(','));
const stayMs = D.items.filter((i) => i.type === 'stay').reduce((s, i) => s + i.t1 - i.t0, 0);
ok(stayMs > 20 * 3600e3, 'günün çoğu durakta: ' + (stayMs / 3600e3).toFixed(1) + ' sa');

// --- Cuma: arabayla dönüş; elle düzeltme ---
const fri = addDays(dayStart(END), -5);
const F = analyze(pts, { from: fri, to: addDays(fri, 1), hints: { home, work } });
const back = F.items.filter((i) => i.type === 'trip')[1];
ok(back && back.mode === 'car', 'Cuma dönüş araba: ' + (back && back.mode) + ' ort ' + (back && (back.avg * 3.6).toFixed(0)) + ' km/s');
const F2 = analyze(pts, { from: fri, to: addDays(fri, 1), overrides: { [back.t0]: 'bike' } });
ok(F2.items.filter((i) => i.type === 'trip')[1].mode === 'bike' && F2.totals.modes.bike.dist > 3000, 'elle tür düzeltme işliyor');

// --- Veri yok: 3 saat kapalı + 6 km uzakta açıldı -> tahmin yürütülmez ---
const g = [{ t: 0, lat: 40.4, lon: 49.85 }, { t: 60e3, lat: 40.4, lon: 49.8503 }, { t: 3 * 3600e3, lat: 40.45, lon: 49.85 }, { t: 3 * 3600e3 + 60e3, lat: 40.45, lon: 49.8503 }];
const G = analyze(g, { from: 0, to: 4 * 3600e3 });
ok(G.items.some((i) => i.type === 'gap') && G.totals.dist < 100, 'uzun boşluk = veri yok');

// --- Kayıt açıkken son nokta eski -> hâlâ orada duruyor ---
const N = analyze(g.slice(0, 2), { from: 0, to: 4 * 3600e3, now: 2 * 3600e3 });
ok(N.items.length === 1 && N.items[0].type === 'stay' && N.items[0].t1 === 2 * 3600e3, 'açık uçlu durak şimdiye uzar');

console.log(fail ? `\n${fail} HATA` : '\nTÜMÜ GEÇTİ');
process.exit(fail ? 1 : 0);
