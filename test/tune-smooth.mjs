// Düzeltme ayarlarını sınama: bilinen bir gerçek yol + gerçekçi (zamanla ilişkili) GPS gürültüsü üret,
// düzeltme sonrası hatayı ve uzunluk şişmesini ölç.   node test/tune-smooth.mjs
import { smoothTrack, simplifyIdx, pathLen, toXY, SM } from '../src/smooth.js';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

const LAT0 = 40.377, LON0 = 49.853, K = Math.cos(LAT0 * Math.PI / 180), M = 111195;
const ll = (x, y) => ({ lat: LAT0 + y / M, lon: LON0 + x / (M * K) });

// Gerçek yol: köşe noktaları (m). Düz cadde, 90° dönüş, karşıya geçiş (15 m), devam.
// vc: seyir hızı, vk: köşe yakınındaki hız (araç dönüşte yavaşlar), step: örnekleme aralığı (sn)
export function truePath(vc, vk, step) {
  const wp = [[0, 0], [260, 0], [260, 120], [330, 120], [330, 135], [420, 135]];
  const pts = []; let t = 0, next = 0, seg = 0, x = 0, y = 0;
  const h = 0.1;
  while (seg < wp.length - 1) {
    const [x1, y1] = wp[seg + 1], dx = x1 - x, dy = y1 - y, d = Math.hypot(dx, dy);
    const [px, py] = wp[seg], dPrev = Math.hypot(x - px, y - py);
    const nearCorner = (seg + 1 < wp.length - 1 && d < 18) || (seg > 0 && dPrev < 18);
    const v = nearCorner ? vk : vc, ux = dx / (d || 1), uy = dy / (d || 1);
    if (t >= next - 1e-9) { pts.push({ x, y, vx: ux * v, vy: uy * v, t: Math.round(t * 1000) }); next += step; }
    if (d <= v * h) { x = x1; y = y1; seg++; } else { x += ux * v * h; y += uy * v * h; }
    t += h;
  }
  return pts;
}

// Gürültü: yavaş değişen sapma (Gauss–Markov; bina yansıması) + beyaz gürültü + bir aykırı patlama.
// withV: Doppler hız/yön ölçümü de üret (hız gürültüsü sigV m/s, eksen başına)
export function noisy(tp, seed, step, withV, sigV = 0.3, sigB = 6, tau = 20, sigW = 2) {
  const r = rng(seed); let bx = gauss(r) * sigB, by = gauss(r) * sigB;
  const a = Math.exp(-step / tau), s = sigB * Math.sqrt(1 - a * a);
  return tp.map((p, i) => {
    bx = a * bx + s * gauss(r); by = a * by + s * gauss(r);
    const x = p.x + bx + gauss(r) * sigW; let y = p.y + by + gauss(r) * sigW;
    if (i >= 60 && i < 66) y += 22; // 6 ardışık nokta 22 m yana sıçrıyor
    const o = { t: p.t, ...ll(x, y), acc: 8 + r() * 8, spd: null, crs: null };
    if (withV) {
      const vx = p.vx + gauss(r) * sigV, vy = p.vy + gauss(r) * sigV;
      o.spd = Math.hypot(vx, vy); o.crs = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
    }
    return o;
  });
}

// Bir izin gerçek yola göre hatası: her gerçek noktanın ize (çizgiye) en yakın uzaklığı.
function errTo(track, tp) {
  const xy = toXY([ll(0, 0), ...track]);
  const X = Array.from(xy.x).slice(1), Y = Array.from(xy.y).slice(1);
  let sum = 0, mx = 0;
  for (const p of tp) {
    let best = 1e9;
    for (let i = 1; i < X.length; i++) {
      const dx = X[i] - X[i - 1], dy = Y[i] - Y[i - 1], L = dx * dx + dy * dy || 1e-9;
      const u = Math.max(0, Math.min(1, ((p.x - X[i - 1]) * dx + (p.y - Y[i - 1]) * dy) / L));
      best = Math.min(best, Math.hypot(p.x - (X[i - 1] + u * dx), p.y - (Y[i - 1] + u * dy)));
    }
    sum += best * best; mx = Math.max(mx, best);
  }
  return { rms: Math.sqrt(sum / tp.length), max: mx };
}

function run(label, vc, vk, step, eps, withV, sigV) {
  const tp = truePath(vc, vk, step), trueLen = pathLen(tp.map((p) => ll(p.x, p.y)));
  const acc = { raw: [0, 0, 0], sm: [0, 0, 0], dp: [0, 0, 0] }; const N = 16;
  let nDp = 0;
  for (let seed = 1; seed <= N; seed++) {
    const raw = noisy(tp, seed * 7919, step, withV, sigV);
    const sm = smoothTrack(raw), idx = simplifyIdx(sm, eps), dp = idx.map((i) => sm[i]);
    nDp += dp.length;
    for (const [k, tr] of [['raw', raw], ['sm', sm], ['dp', dp]]) {
      const e = errTo(tr, tp); acc[k][0] += e.rms / N; acc[k][1] += e.max / N; acc[k][2] += pathLen(tr) / trueLen / N;
    }
  }
  const f = (a) => `rms ${a[0].toFixed(1)} m · en büyük ${a[1].toFixed(1)} m · uzunluk ×${a[2].toFixed(2)}`;
  console.log(`${label.padEnd(34)} ham: ${f(acc.raw)}`);
  console.log(`${''.padEnd(34)} düz: ${f(acc.sm)}`);
  console.log(`${''.padEnd(34)} +DP: ${f(acc.dp)}  (${Math.round(nDp / N)} nokta)`);
}

if (process.argv[1] && process.argv[1].endsWith('tune-smooth.mjs')) {
  console.log('SM =', JSON.stringify(SM));
  run('YAYA yalnız konum', 1.4, 1.4, 1.5, 5, false);
  run('YAYA + hız (σv 0.3)', 1.4, 1.4, 1.5, 5, true, 0.3);
  run('YAYA + hız (σv 0.6, kötü)', 1.4, 1.4, 1.5, 5, true, 0.6);
  run('ARABA yalnız konum', 11, 3, 1, 6, false);
  run('ARABA + hız (σv 0.3)', 11, 3, 1, 6, true, 0.3);
}
