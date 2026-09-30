// Motor testi: sentetik 14 günlük veride beklenen sonuçlar çıkıyor mu?  ->  node test/engine.test.mjs
import { analyze, dayStart, addDays, hav } from '../src/engine.js';
import { demoData } from '../src/demo.js';

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'OK   ' : 'FAIL ') + msg); if (!c) fail++; };
const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const km = (m) => (m / 1000).toFixed(1) + 'km';
const modeLine = (m) => Object.entries(m).map(([k, v]) => `${k} ${km(v.dist)} ${(v.dur / 60e3).toFixed(0)}dk`).join(' | ');

// Sabit bitiş: 30 Eyl 2026 Çarşamba 23:00 (yerel). 14 gün: 17 Eyl Per … 30 Eyl Çar.
const END = new Date(2026, 8, 30, 23, 0).getTime();
const from = addDays(dayStart(END), -13), to = addDays(dayStart(END), 1);
const thu = addDays(dayStart(END), -6), fri = addDays(dayStart(END), -5);

// ================= A) GÜRÜLTÜSÜZ veri: kesin beklentiler =================
console.log('=== A) gürültüsüz');
const clean = demoData(END, 14, { noise: false });
console.log('nokta:', clean.points.length, 'hareket kaydı:', clean.acts.length);
const R = analyze(clean.points, { from, to, detect: true, acts: clean.acts });
const home = R.places.find((p) => p.kind === 'home'), work = R.places.find((p) => p.kind === 'work');
ok(!!home && Math.abs(home.lat - 40.4093) < 0.001, 'ev bulundu, konumu doğru');
ok(!!work && Math.abs(work.lat - 40.3745) < 0.001, 'iş bulundu, konumu doğru');
console.log(R.places.map((p) => `${p.name} ${(p.total / 3600e3).toFixed(1)}sa ${p.visits}x`).join(' | '));
const m = R.totals.modes;
console.log(modeLine(m));
ok(m.metro.dist > 50000, 'metro tespit edildi');
ok(m.car.dist > 15000, 'araba tespit edildi');
ok(m.walk.dist > 5000, 'yaya tespit edildi');
ok(m.bus.dist > 8000 && m.bus.dist < 13000, 'otobüs tespit edildi (2 Perşembe): ' + km(m.bus.dist));
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

// Tek gün (Çarşamba): ev → iş → ev
const dayOpt = (d, extra) => ({ from: d, to: addDays(d, 1), hints: { home, work }, acts: clean.acts, ...extra });
const D = analyze(clean.points, dayOpt(dayStart(END)));
const seq = (X) => X.items.map((i) => (i.type === 'stay' ? i.place.name : i.type === 'trip' ? i.mode : 'gap')).join(' > ');
console.log(seq(D));
ok(seq(D) === 'Ev > metro > İş > metro > Ev', 'günlük sıra doğru');
const trip = D.items.find((i) => i.type === 'trip');
ok(trip.legs.map((l) => l.mode).join(',') === 'walk,metro,walk', 'parçalar: ' + trip.legs.map((l) => l.mode).join(','));
ok(trip.fromStay && trip.fromStay.place.kind === 'home' && trip.toStay.place.kind === 'work', 'yolculuğun uçları: Ev → İş');
ok(trip.dash.filter(Boolean).length === 1, 'metro parçası kesikli (GPS yok)');

// Perşembe: dönüş otobüsle — durağa yürü, durakta bekle (5 dk'yı aşarsa kısa durak olur), otobüs, yürü
const T = analyze(clean.points, dayOpt(thu));
const seqLegs = (X) => X.items.map((i) => (i.type === 'stay' ? (i.wait ? '(bekleme)' : i.place.name) : i.type === 'trip' ? i.legs.map((l) => l.mode).join('+') : 'gap')).join(' > ');
console.log('Perşembe:', seqLegs(T));
const busTrip = T.items.find((i) => i.type === 'trip' && i.legs.some((l) => l.mode === 'bus'));
const bl = busTrip && busTrip.legs.find((l) => l.mode === 'bus');
ok(!!bl && busTrip.legs[busTrip.legs.length - 1].mode === 'walk', 'Perşembe dönüşte otobüs + sonunda yürüyüş var');
ok(bl && bl.stops >= 8 && bl.stops / (bl.dist / 1000) >= 1.5, 'otobüs duruşları sayıldı: ' + (bl && bl.stops) + ' (' + (bl && km(bl.dist)) + ')');
ok(T.items.some((i) => i.type === 'stay' && i.wait), 'durakta bekleme, "bekleme" olarak işaretlendi');

// Cuma: dönüş arabayla (seyrek ışık, öncesinde yürüyüş yok) -> otobüs SANILMAMALI
const F = analyze(clean.points, dayOpt(fri));
const back = F.items.filter((i) => i.type === 'trip')[1];
ok(back && back.mode === 'car', 'Cuma dönüş araba: ' + (back && back.mode) + ' ort ' + (back && (back.avg * 3.6).toFixed(0)) + ' km/s, ' + back.legs[0].stops + ' duruş');
const F2 = analyze(clean.points, dayOpt(fri, { overrides: { [back.t0]: 'bike' } }));
ok(F2.items.filter((i) => i.type === 'trip')[1].mode === 'bike' && F2.totals.modes.bike.dist > 3000, 'elle tür düzeltme işliyor');

// Hareket kaydı YOKKEN de (yalnız hızla) makul sonuç: yürü/metro/araba ayrışmalı
const N0 = analyze(clean.points, { from, to, detect: true });
console.log('hareket kaydı olmadan:', modeLine(N0.totals.modes));
ok(N0.totals.modes.walk.dist > 5000 && N0.totals.modes.metro.dist > 50000 && N0.totals.modes.car.dist + N0.totals.modes.bus.dist > 20000, 'hareket kaydı olmadan da türler ayrışıyor');

// ================= B) GÜRÜLTÜLÜ veri: düzeltme işe yarıyor mu? =================
console.log('=== B) gürültülü (bina yansıması + sıçrama)');
const noisy = demoData(END, 14);
const Rn = analyze(noisy.points, { from, to, detect: true, acts: noisy.acts });
console.log(modeLine(Rn.totals.modes));
for (const k of ['walk', 'bus', 'car']) {
  const ratio = Rn.totals.modes[k].dist / m[k].dist;
  ok(ratio > 0.93 && ratio < 1.10, `${k} mesafesi gürültüyle şişmedi: ×${ratio.toFixed(2)}`);
}
const Dn = analyze(noisy.points, { from: dayStart(END), to, detect: false, hints: { home, work }, acts: noisy.acts });
ok(seq(Dn) === 'Ev > metro > İş > metro > Ev', 'gürültülü günlük sıra doğru: ' + seq(Dn));
// Ham iz ne kadar şişerdi? (düzeltmesiz uzunluk / düzeltilmiş uzunluk)
const wt = Dn.items.find((i) => i.type === 'trip');
const rawPts = noisy.points.filter((p) => p.t >= wt.t0 && p.t <= wt.legs[0].t1);
let rawLen = 0; for (let i = 1; i < rawPts.length; i++) rawLen += hav(rawPts[i - 1], rawPts[i]);
console.log(`ilk yürüyüş: ham ${rawLen.toFixed(0)} m → düzeltilmiş ${wt.legs[0].dist.toFixed(0)} m`);
ok(rawLen / wt.legs[0].dist > 1.15, 'düzeltme zikzağı azaltıyor (ham en az %15 daha uzun)');
// Yalnız konumla (eski kayıtlar: hız/yön yok) da şişme sınırlı kalmalı
const old = noisy.points.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, acc: p.acc, spd: null }));
const Ro = analyze(old, { from, to, detect: true });
const ratioOld = Ro.totals.modes.walk.dist / N0.totals.modes.walk.dist;
ok(ratioOld > 0.85 && ratioOld < 1.15, `hız/yön olmadan yaya mesafesi: ×${ratioOld.toFixed(2)}`);

// ================= C) Özel durumlar =================
console.log('=== C) özel durumlar');
// Veri yok: 3 saat kapalı + 6 km uzakta açıldı -> tahmin yürütülmez
const g = [{ t: 0, lat: 40.4, lon: 49.85 }, { t: 60e3, lat: 40.4, lon: 49.8503 }, { t: 3 * 3600e3, lat: 40.45, lon: 49.85 }, { t: 3 * 3600e3 + 60e3, lat: 40.45, lon: 49.8503 }];
const G = analyze(g, { from: 0, to: 4 * 3600e3 });
ok(G.items.some((i) => i.type === 'gap') && G.totals.dist < 100, 'uzun boşluk = veri yok');

// Kayıt açıkken son nokta eski -> hâlâ orada duruyor
const N = analyze(g.slice(0, 2), { from: 0, to: 4 * 3600e3, now: 2 * 3600e3 });
ok(N.items.length === 1 && N.items[0].type === 'stay' && N.items[0].t1 === 2 * 3600e3, 'açık uçlu durak şimdiye uzar');

// Kayıt boşluğu: 40 dk bir yerde (yalnız başta nokta var), sonra 120 m ötede belirip yürümeye devam.
// Beklenen: durak, boşluğun sonuna kadar sürer; çıkış ~86 sn önce; ilk 120 m tahmini (kesikli) yürüyüş.
const e = [];
for (let i = 0; i < 6; i++) e.push({ t: i * 20e3, lat: 40.4, lon: 49.85, acc: 8 });
const tB = 40 * 60e3;
for (let i = 0; i < 80; i++) e.push({ t: tB + i * 2500, lat: 40.4 + 120 / 111195, lon: 49.85 + (i * 3.5) / 85000, acc: 8 }); // doğuya 280 m yürüyüş
const E = analyze(e, { from: 0, to: 3600e3 });
const es = E.items[0], et = E.items[1];
console.log('boşluk:', E.items.map((i) => `${i.type}${i.type === 'trip' ? ' ' + i.mode + ' ' + i.dist.toFixed(0) + 'm' : ''} ${(i.t0 / 60e3).toFixed(1)}–${(i.t1 / 60e3).toFixed(1)}dk`).join(' | '));
ok(es.type === 'stay' && Math.abs(es.t1 - (tB - 86e3)) < 5e3, 'durak, tahmini çıkış anında bitiyor (boşluğun başında değil)');
ok(et && et.type === 'trip' && et.mode === 'walk' && et.dist > 350 && et.dash[0] === true && et.dash.filter(Boolean).length === 1, 'ilk 120 m tahmini (kesikli), gerisi kayıtlı yürüyüş');

// Pil tasarrufu kipi: 2 saat yerinde duruyor, konum kaba (±65 m) ve 20–70 m oynuyor. Hareket SANILMAMALI.
{
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const c = [];
  for (let t = 0; t <= 2 * 3600e3; t += 40e3 + rnd() * 200e3) c.push({ t: Math.round(t), lat: 40.4 + (rnd() - 0.5) * 120 / 111195, lon: 49.85 + (rnd() - 0.5) * 120 / 85000, acc: 65, spd: null, crs: null });
  const Cz = analyze(c, { from: 0, to: 3 * 3600e3 });
  ok(Cz.items.length === 1 && Cz.items[0].type === 'stay' && Cz.totals.trips === 0, 'kaba konum oynaması hareket sayılmıyor: ' + Cz.items.map((i) => i.type).join(','));
}

// Evde masada duran telefon: konum 1 dakikalığına 375 m öteye sıçrayıp (Wi-Fi konumu) geri geliyor.
// Gerçek kayıttan (30 Eyl 23:47 "Araba 750 m", 23:53 "Yaya 343 m"). Hayalet yolculuk ÇIKMAMALI.
{
  const home = { lat: 40.4, lon: 49.85 }, far = { lat: 40.4 + 375 / 111195, lon: 49.85 };
  const pts = [];
  for (let t = 0; t <= 60 * 60e3; t += 30e3) pts.push({ t, ...home, acc: 12, spd: 0, crs: null });
  // 30. dakikada 3 noktalık sıçrama + 45. dakikada tek noktalık sıçrama
  pts.push({ t: 30 * 60e3 + 10e3, ...far, acc: 65, spd: null }, { t: 30 * 60e3 + 20e3, lat: far.lat + 0.0003, lon: far.lon, acc: 65, spd: null }, { t: 30 * 60e3 + 25e3, ...far, acc: 48, spd: null });
  pts.push({ t: 45 * 60e3 + 10e3, lat: 40.4 - 170 / 111195, lon: 49.85, acc: 30, spd: null });
  pts.sort((x, y) => x.t - y.t);
  const still = []; for (let t = 0; t <= 60 * 60e3; t += 60e3) still.push({ t, k: 'S', c: 2 });
  const H1 = analyze(pts, { from: 0, to: 2 * 3600e3, acts: still });
  ok(H1.totals.trips === 0 && H1.items.length === 1, 'evde GPS sıçraması yolculuk sayılmıyor (hareket kaydıyla): ' + H1.items.map((i) => i.type).join(','));
  const H2 = analyze(pts, { from: 0, to: 2 * 3600e3 });
  ok(H2.totals.trips === 0, 'evde GPS sıçraması yolculuk sayılmıyor (hareket kaydı olmadan da): ' + H2.items.map((i) => i.type).join(','));
  // Gerçek kısa çıkış: markete 300 m yürü, 4 dk kal, geri dön (GPS iyi, hız ölçülüyor) → KALMALI
  const walkPts = [];
  for (let t = 0; t <= 20 * 60e3; t += 60e3) walkPts.push({ t, ...home, acc: 10, spd: 0 });
  let tt = 20 * 60e3;
  for (let x = 3; x <= 300; x += 3) { tt += 2200; walkPts.push({ t: tt, lat: 40.4, lon: 49.85 + x / 85000, acc: 8, spd: 1.35 }); }
  for (let k = 0; k < 4; k++) { tt += 60e3; walkPts.push({ t: tt, lat: 40.4, lon: 49.85 + 300 / 85000, acc: 10, spd: 0 }); }
  for (let x = 297; x >= 0; x -= 3) { tt += 2200; walkPts.push({ t: tt, lat: 40.4, lon: 49.85 + x / 85000, acc: 8, spd: 1.35 }); }
  for (let k = 1; k <= 20; k++) walkPts.push({ t: tt + k * 60e3, ...home, acc: 10, spd: 0 });
  const Wk = analyze(walkPts, { from: 0, to: 2 * 3600e3 });
  ok(Wk.totals.trips === 2 && Wk.totals.modes.walk.dist > 450, 'gerçek kısa çıkış (markete gidip dönme) korunuyor: ' + Wk.totals.trips + ' yolculuk, ' + Wk.totals.modes.walk.dist.toFixed(0) + ' m');
}

// ---- Dur-kalk senaryoları (hareket kaydı YOK, yalnız hız): doğuya düz yol, 3 m mesafe süzgeci ----
// plan: [süre sn, hız m/sn] parçaları. Hız 0 iken nokta çıkmaz (telefon duruyor).
function drive(plan, t0 = 0) {
  const pts = []; let t = t0, x = 0, lastX = -9;
  pts.push({ t, lat: 40.4, lon: 49.85, acc: 6, spd: 0, crs: -1 });
  for (const [dur, v] of plan) {
    for (let s = 0; s < dur; s++) {
      t += 1000; x += v;
      if (x - lastX >= 3) { pts.push({ t, lat: 40.4, lon: 49.85 + x / 85000, acc: 6, spd: v, crs: 90 }); lastX = x; }
    }
  }
  return { pts, end: t };
}
const stayAt = (t0, x, mins) => { const o = []; for (let i = 0; i <= mins * 3; i++) o.push({ t: t0 + i * 20e3, lat: 40.4, lon: 49.85 + x / 85000, acc: 6, spd: 0, crs: -1 }); return o; };
const hops = (n, go, v, stop) => Array.from({ length: n }, () => [[go, v], [stop, 0]]).flat();
const legsOf = (X) => X.items.filter((i) => i.type === 'trip').map((t) => t.legs.map((l) => l.mode).join('+')).join(' | ');

// Yoğun trafikte araba: kapıdan biniliyor, 25 sn git / 40 sn dur × 20. Yaya ya da otobüs SANILMAMALI.
const jam = drive(hops(20, 25, 6, 40));
const J = analyze([...jam.pts, ...stayAt(jam.end + 20e3, 20 * 25 * 6, 8)], { from: 0, to: 3 * 3600e3 });
const jt = J.items.find((i) => i.type === 'trip');
ok(legsOf(J) === 'car', 'dur-kalk trafikte araba: ' + legsOf(J) + ' (' + (jt ? jt.legs[0].stops : '?') + ' duruş)');

// Durağa 200 m yürü, 3 dk bekle (durak sayılmayacak kadar kısa), otobüs 45 sn git / 20 sn dur × 12, 150 m yürü.
const busRide = drive([[150, 1.35], [180, 0], ...hops(12, 45, 9, 20), [110, 1.35]]);
const Bz = analyze([...busRide.pts, ...stayAt(busRide.end + 20e3, 150 * 1.35 + 12 * 45 * 9 + 110 * 1.35, 8)], { from: 0, to: 3 * 3600e3 });
ok(legsOf(Bz) === 'walk+bus+walk', 'yürü + bekle + otobüs + yürü: ' + legsOf(Bz));

// Koşu: hareket işlemcisi "koşuyor" diyor, 3,2 m/sn ile 2 km. Araç/bisiklet SANILMAMALI.
const jog = drive([[640, 3.2]]);
const jogActs = []; for (let t = 0; t <= jog.end; t += 60e3) jogActs.push({ t, k: 'R', c: 2 });
const Jg = analyze([...jog.pts, ...stayAt(jog.end + 20e3, 640 * 3.2, 8)], { from: 0, to: 3 * 3600e3, acts: jogActs });
ok(legsOf(Jg) === 'walk', 'koşu (hareket kaydıyla) yaya sayılır: ' + legsOf(Jg));

console.log(fail ? `\n${fail} HATA` : '\nTÜMÜ GEÇTİ');
process.exit(fail ? 1 : 0);
