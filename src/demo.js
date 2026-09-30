// Sentetik GPS verisi — web önizlemesi ve motor testleri için (gerçek cihazda kullanılmaz).
// Senaryo (Bakü): hafta içi ev → yürü → metro (GPS yok) → yürü → iş → akşam dönüş;
// Cuma işten arabayla dönüş; Cumartesi arabayla AVM + parkta yürüyüş; Pazar evde.

const HOME = { lat: 40.4093, lon: 49.8671 };
const ST_A = { lat: 40.4128, lon: 49.8712 };  // eve yakın metro
const ST_B = { lat: 40.3719, lon: 49.8440 };  // işe yakın metro
const WORK = { lat: 40.3745, lon: 49.8402 };
const MALL = { lat: 40.3776, lon: 49.9020 };
const PARK = { lat: 40.3655, lon: 49.8355 };

// Deterministik rastgele (test tekrarlanabilir olsun)
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export function demoPoints(endT, nDays = 14) {
  const r = rng(7), pts = [];
  const jit = (m) => (r() - 0.5) * 2 * m / 111000;
  const emit = (t, c, acc = 8) => pts.push({ t: Math.round(t), lat: c.lat + jit(5), lon: c.lon + jit(5), acc, spd: null });
  // a→b doğrusal hareket, v m/s, her step sn'de bir nokta; bitiş zamanını döner
  const move = (t, a, b, v, step) => {
    const d = Math.hypot((b.lat - a.lat) * 111000, (b.lon - a.lon) * 85000) * 1.0;
    const n = Math.max(1, Math.round(d / v / step));
    for (let i = 1; i <= n; i++) emit(t + i * step * 1000, { lat: a.lat + (b.lat - a.lat) * i / n, lon: a.lon + (b.lon - a.lon) * i / n });
    return t + n * step * 1000;
  };
  // yerinde durma: ~12 dakikada bir kayma noktası (iOS mesafe filtresi davranışı)
  const stay = (t, c, until) => { for (let x = t + 12 * 60e3; x < until; x += 12 * 60e3) emit(x, c, 15); return until; };
  const metro = (t, a, b) => { const tt = t + 14 * 60e3 + r() * 120e3; emit(tt, b); return tt; }; // arada nokta yok

  const end = new Date(endT);
  const d0 = new Date(end.getFullYear(), end.getMonth(), end.getDate() - nDays + 1).getTime();
  let t = d0; emit(t, HOME);
  for (let i = 0; i < nDays; i++) {
    const day = new Date(d0); day.setDate(day.getDate() + i);
    const base = day.getTime(), wd = day.getDay(), H = 3600e3;
    if (wd >= 1 && wd <= 5) {
      t = stay(t, HOME, base + 8 * H + r() * 35 * 60e3);
      t = move(t, HOME, ST_A, 1.35, 12);
      t = metro(t, ST_A, ST_B);
      t = move(t, ST_B, WORK, 1.3, 12);
      t = stay(t, WORK, base + 18 * H + r() * 50 * 60e3);
      if (wd === 5) t = move(t, WORK, HOME, 7.5 + r() * 2, 4); // Cuma: arabayla dönüş
      else { t = move(t, WORK, ST_B, 1.3, 12); t = metro(t, ST_B, ST_A); t = move(t, ST_A, HOME, 1.35, 12); }
    } else if (wd === 6) {
      t = stay(t, HOME, base + 12 * H);
      t = move(t, HOME, MALL, 9, 4);
      t = stay(t, MALL, t + 2 * H);
      t = move(t, MALL, PARK, 8, 4);
      t = move(t, PARK, { lat: PARK.lat + 0.006, lon: PARK.lon + 0.004 }, 1.2, 12); // parkta yürüyüş
      t = move(t, { lat: PARK.lat + 0.006, lon: PARK.lon + 0.004 }, PARK, 1.2, 12);
      t = move(t, PARK, HOME, 9, 4);
    }
    // Pazar: evde
  }
  stay(t, HOME, Math.min(endT, t + 20 * 3600e3));
  return pts.filter((p) => p.t <= endT);
}
