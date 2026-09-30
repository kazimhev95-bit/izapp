// Sentetik veri — web önizlemesi ve motor testleri için (gerçek cihazda kullanılmaz).
// Gerçeğe yakın olsun diye: 3 m mesafe süzgeci, GPS hız/yön ölçümü, binalardan yansıma gürültüsü
// (yavaş değişen sapma + beyaz gürültü) ve telefonun hareket kaydı (yürüyor/araçta/duruyor) da üretilir.
// Senaryo (Bakü): hafta içi ev → yürü → metro (GPS yok) → yürü → iş → akşam dönüş;
// Perşembe dönüş otobüsle (durağa yürü, bekle, durak durak git); Cuma dönüş arabayla;
// Cumartesi arabayla AVM + parkta yürüyüş; Pazar evde.

const HOME = [40.4093, 49.8671], ST_A = [40.4128, 49.8712], ST_B = [40.3719, 49.8440], WORK = [40.3745, 49.8402];
const MALL = [40.3776, 49.9020], PARK = [40.3655, 49.8355];
// Köşeli güzergâhlar (sokak sokak dönerek gidiş)
const R_HOME_STA = [HOME, [40.4093, 49.8700], [40.4128, 49.8700], ST_A];
const R_STB_WORK = [ST_B, [40.3719, 49.8402], WORK];
const BUS_STOP_W = [40.3770, 49.8402], BUS_STOP_H = [40.4075, 49.8640];
const R_BUS = [BUS_STOP_W, [40.3770, 49.8520], [40.3950, 49.8520], [40.3950, 49.8640], BUS_STOP_H];
const R_CAR_WH = [WORK, [40.3745, 49.8500], [40.3980, 49.8500], [40.3980, 49.8671], HOME];
const R_CAR_HM = [HOME, [40.4093, 49.8850], [40.3776, 49.8850], MALL];
const R_CAR_MP = [MALL, [40.3776, 49.8600], [40.3655, 49.8600], PARK];
const R_PARK = [PARK, [40.3700, 49.8355], [40.3700, 49.8400], [40.3655, 49.8400], PARK];
const R_CAR_PH = [PARK, [40.3655, 49.8500], [40.4000, 49.8500], [40.4000, 49.8671], HOME];

const M_LAT = 111195, M_LON = 111195 * Math.cos(40.39 * Math.PI / 180);
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

// opt.noise=false: gürültüsüz (testlerin kesin beklentileri için). Dönüş: { points, acts }
export function demoData(endT, nDays = 14, opt = {}) {
  const noise = opt.noise !== false;
  const r = rng(7), g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const points = [], acts = [];
  let bx = 0, by = 0, lastBias = 0;           // GPS'in yavaş değişen sapması (m)
  let pos = [...HOME], lastEmit = null, lastAct = null, lastActT = 0;

  const act = (t, k) => { if (k !== lastAct || t - lastActT >= 60e3) { acts.push({ t: Math.round(t), k, c: 2 }); lastAct = k; lastActT = t; } };
  // Konum yayınla: gerçek konuma gürültü ekle, hız/yön ölçümü koy.
  const emit = (t, c, v, crs) => {
    if (noise) {
      const a = Math.exp(-Math.min(600, (t - lastBias) / 1000) / 20), s = 6 * Math.sqrt(1 - a * a);
      bx = a * bx + s * g(); by = a * by + s * g(); lastBias = t;
    }
    const nx = noise ? bx + g() * 1.5 : 0, ny = noise ? by + g() * 1.5 : 0;
    const p = { t: Math.round(t), lat: c[0] + ny / M_LAT, lon: c[1] + nx / M_LON, acc: noise ? 6 + r() * 8 : 5, spd: null, crs: null };
    if (v != null) {
      const vx = v * Math.sin(crs) + (noise ? g() * 0.25 : 0), vy = v * Math.cos(crs) + (noise ? g() * 0.25 : 0);
      p.spd = Math.hypot(vx, vy); p.crs = p.spd > 0.3 ? (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360 : -1;
    }
    points.push(p); lastEmit = { t, c: [...c] };
  };
  // Güzergâh boyunca hareket. vc: seyir hızı, vk: köşe hızı, k: hareket türü, stopEvery/dwell: duraklar (m, sn).
  // 3 m mesafe süzgeci: yalnız ≥3 m yer değiştirince nokta çıkar (duruşta nokta yok). Bitiş zamanını döner.
  const go = (t, route, vc, vk, k, stopEvery = 0, dwell = 0) => {
    pos = [...route[0]]; let sinceStop = 0;
    for (let i = 1; i < route.length; i++) {
      const to = route[i];
      for (;;) {
        const dy = (to[0] - pos[0]) * M_LAT, dx = (to[1] - pos[1]) * M_LON, d = Math.hypot(dx, dy);
        if (d < 0.5) break;
        const prev = route[i - 1], dPrev = Math.hypot((pos[0] - prev[0]) * M_LAT, (pos[1] - prev[1]) * M_LON);
        // köşe yakınında ve duruşun hemen öncesi/sonrasında yavaş (fren / kalkış)
        const slow = (d < 20 && i < route.length - 1) || (dPrev < 20 && i > 1) || (stopEvery && (sinceStop < 20 || sinceStop > stopEvery - 20));
        const v = slow ? vk : vc, h = 0.5, stepM = Math.min(d, v * h), crs = Math.atan2(dx, dy);
        pos = [pos[0] + (dy / d) * stepM / M_LAT, pos[1] + (dx / d) * stepM / M_LON];
        t += h * 1000; sinceStop += stepM; act(t, k);
        const moved = lastEmit ? Math.hypot((pos[0] - lastEmit.c[0]) * M_LAT, (pos[1] - lastEmit.c[1]) * M_LON) : 99;
        if (moved >= 3 && (!lastEmit || t - lastEmit.t >= 1000)) emit(t, pos, v, crs);
        if (stopEvery && sinceStop >= stopEvery && d > 40) { // durak / kırmızı ışık: araç içinde bekleme
          sinceStop = 0;
          for (let w = 0; w < dwell; w += 5) { t += 5000; act(t, k); }
        }
      }
    }
    return t;
  };
  // Yerinde durma: ara sıra (12 dk) bir sürüklenme noktası; hareket kaydı "duruyor".
  const stay = (t, c, until) => {
    pos = [...c];
    for (let x = t + 12 * 60e3; x < until; x += 12 * 60e3) { emit(x, c, 0, 0); act(x, 'S'); }
    act(until - 1000, 'S');
    return until;
  };
  // Metro: yer altında GPS yok — bir sonraki nokta karşı istasyonda çıkınca gelir.
  const metro = (t, to) => { const tt = t + 14 * 60e3 + r() * 120e3; pos = [...to]; emit(tt, to, 1.2, 0); return tt; };

  const end = new Date(endT);
  const d0 = new Date(end.getFullYear(), end.getMonth(), end.getDate() - nDays + 1).getTime();
  let t = d0; emit(t, HOME, 0, 0); act(t, 'S');
  const rev = (x) => [...x].reverse();
  for (let i = 0; i < nDays; i++) {
    const day = new Date(d0); day.setDate(day.getDate() + i);
    const base = day.getTime(), wd = day.getDay(), H = 3600e3;
    if (wd >= 1 && wd <= 5) {
      t = stay(t, HOME, base + 8 * H + r() * 35 * 60e3);
      t = go(t, R_HOME_STA, 1.35, 1.35, 'W');
      t = metro(t, ST_B);
      t = go(t, R_STB_WORK, 1.3, 1.3, 'W');
      t = stay(t, WORK, base + 18 * H + r() * 50 * 60e3);
      if (wd === 5) t = go(t, R_CAR_WH, 11, 4, 'A', 1300, 35);       // Cuma: arabayla (seyrek ışık)
      else if (wd === 4) {                                            // Perşembe: otobüsle
        t = go(t, [WORK, BUS_STOP_W], 1.3, 1.3, 'W');
        for (let w = 0; w < 4 * 60; w += 30) { t += 30e3; act(t, 'S'); } // durakta 4 dk bekleme
        t = go(t, R_BUS, 9, 4, 'A', 420, 22);                          // ~420 m'de bir durak, 22 sn
        t = go(t, [BUS_STOP_H, HOME], 1.3, 1.3, 'W');
      } else { t = go(t, rev(R_STB_WORK), 1.3, 1.3, 'W'); t = metro(t, ST_A); t = go(t, rev(R_HOME_STA), 1.35, 1.35, 'W'); }
    } else if (wd === 6) {
      t = stay(t, HOME, base + 12 * H);
      t = go(t, R_CAR_HM, 12, 4, 'A', 1500, 30);
      t = stay(t, MALL, t + 2 * H);
      t = go(t, R_CAR_MP, 11, 4, 'A', 1500, 30);
      t = go(t, R_PARK, 1.2, 1.2, 'W');
      t = go(t, R_CAR_PH, 12, 4, 'A', 1500, 30);
    }
    // Pazar: evde
  }
  stay(t, HOME, Math.min(endT, t + 20 * 3600e3));
  return { points: points.filter((p) => p.t <= endT), acts: acts.filter((a) => a.t <= endT) };
}

export const demoPoints = (endT, nDays = 14) => demoData(endT, nDays).points;
