// GPS izini düzeltme (saf JS). İki adım:
//   1) smoothTrack — Kalman süzgeci + geriye doğru RTS yumuşatıcı (sabit hız modeli). Her noktanın
//      konumu, öncesi VE sonrasındaki noktalara bakılarak düzeltilir; gecikme/kayma yapmaz.
//      Aykırı noktalar (binalardan yansıma ile 20 m yana sıçrama gibi) ağırlığı düşürülerek bastırılır.
//   2) simplify — Douglas–Peucker: düz giden yolda kalan küçük dalgalanmayı atıp köşeleri korur.
// Sonuç: düz yolda düz çizgi; gerçek dönüşler yerinde kalır.
const R_EARTH = 6371000, RAD = Math.PI / 180;

// Enlem/boylam -> yerel metre düzlemi (ilk nokta merkez). Küçük alanlarda hata ihmal edilir.
export function toXY(pts) {
  const lat0 = pts[0].lat, lon0 = pts[0].lon, k = Math.cos(lat0 * RAD);
  const x = new Float64Array(pts.length), y = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) { x[i] = (pts[i].lon - lon0) * RAD * R_EARTH * k; y[i] = (pts[i].lat - lat0) * RAD * R_EARTH; }
  return { x, y, back: (X, Y) => ({ lat: lat0 + Y / (RAD * R_EARTH), lon: lon0 + X / (RAD * R_EARTH * k) }) };
}

// Tek eksen için Kalman + RTS. z: konum ölçümleri (m), t: saniye, r2: konum ölçüm varyansı (m²),
// q: adım başına ivme gürültüsü yoğunluğu (m²/s³), zv/rv2: HIZ ölçümü ve varyansı (yoksa NaN).
// Hız ölçümü GPS'in Doppler hızıdır: bina yansımasından konuma göre çok daha az etkilenir, bu yüzden
// çizginin ŞEKLİNİ (düzlük, dönüş) hız belirler; konum yalnız yavaşça yerine oturtur.
function rts1(z, t, r2, q, zv, rv2) {
  const n = z.length;
  const xf = new Float64Array(n), vf = new Float64Array(n);           // süzülmüş durum
  const f00 = new Float64Array(n), f01 = new Float64Array(n), f11 = new Float64Array(n); // süzülmüş kovaryans
  const xm = new Float64Array(n), vm = new Float64Array(n);           // öngörülen durum
  const m00 = new Float64Array(n), m01 = new Float64Array(n), m11 = new Float64Array(n); // öngörülen kovaryans
  // k adımında önce konum, sonra (varsa) hız ölçümüyle düzelt
  const update = (k, x, v, p00, p01, p11) => {
    let S = p00 + r2[k], K0 = p00 / S, K1 = p01 / S, innov = z[k] - x;
    x += K0 * innov; v += K1 * innov;
    let n00 = (1 - K0) * p00, n01 = (1 - K0) * p01, n11 = p11 - K1 * p01;
    if (zv && rv2[k] === rv2[k]) { // NaN değilse
      S = n11 + rv2[k]; K0 = n01 / S; K1 = n11 / S; innov = zv[k] - v;
      x += K0 * innov; v += K1 * innov;
      const o00 = n00 - K0 * n01, o01 = n01 - K0 * n11, o11 = (1 - K1) * n11;
      n00 = o00; n01 = o01; n11 = o11;
    }
    xf[k] = x; vf[k] = v; f00[k] = n00; f01[k] = n01; f11[k] = n11;
  };
  update(0, z[0], 0, 1e6, 0, 100); // başlangıç: konum/hız bilinmiyor
  for (let k = 1; k < n; k++) {
    const dt = t[k] - t[k - 1], qq = q[k];
    // öngörü: x' = x + v·dt
    xm[k] = xf[k - 1] + vf[k - 1] * dt; vm[k] = vf[k - 1];
    m00[k] = f00[k - 1] + 2 * dt * f01[k - 1] + dt * dt * f11[k - 1] + qq * dt * dt * dt / 3;
    m01[k] = f01[k - 1] + dt * f11[k - 1] + qq * dt * dt / 2;
    m11[k] = f11[k - 1] + qq * dt;
    update(k, xm[k], vm[k], m00[k], m01[k], m11[k]);
  }
  // geriye doğru yumuşatma (Rauch–Tung–Striebel)
  const xs = new Float64Array(n), vs = new Float64Array(n);
  xs[n - 1] = xf[n - 1]; vs[n - 1] = vf[n - 1];
  for (let k = n - 2; k >= 0; k--) {
    const dt = t[k + 1] - t[k];
    const a00 = f00[k] + dt * f01[k], a01 = f01[k], a10 = f01[k] + dt * f11[k], a11 = f11[k];
    const det = m00[k + 1] * m11[k + 1] - m01[k + 1] * m01[k + 1] || 1e-9;
    const i00 = m11[k + 1] / det, i01 = -m01[k + 1] / det, i11 = m00[k + 1] / det;
    const c00 = a00 * i00 + a01 * i01, c01 = a00 * i01 + a01 * i11, c10 = a10 * i00 + a11 * i01, c11 = a10 * i01 + a11 * i11;
    const dx = xs[k + 1] - xm[k + 1], dv = vs[k + 1] - vm[k + 1];
    xs[k] = xf[k] + c00 * dx + c01 * dv; vs[k] = vf[k] + c10 * dx + c11 * dv;
  }
  return { xs, vs };
}

// Ayarlar (saha verisiyle oynanacak yerler burası)
export const SM = {
  MIN_SIGMA: 6,     // m — GPS "±3 m" dese de gerçek sapma daha büyük; en az bu kadar gürültü varsay
  SIGMA_K: 1.0,     // bildirilen doğruluğun çarpanı (hız ölçümü YOKKEN)
  SIGMA_K_V: 2.0,   // hız ölçümü VARKEN konuma daha az güven (şekli hız belirlesin)
  SIGMA_V: 0.45,    // m/s — Doppler hız ölçümünün gürültüsü (eksen başına)
  A_BASE: 0.22,     // m/s² — hız ölçümü yokken yaya için ivme gürültüsü (küçük = daha düz, köşe daha yuvarlak)
  A_PER_V: 0.10,    // hız arttıkça izin verilen ivme artar (araç dönüşleri kesilmesin)
  A_MAX: 2.5,
  A_WITH_V: 1.2,    // m/s² — hız ölçümü varken: dönüşleri hız ölçümü yakalar, serbest bırak
  HUBER_C: 1.3,     // artığı bundan (σ cinsinden) büyük nokta aykırı sayılıp ağırlığı düşürülür
  PASSES: 3,
};

// pts: zaman sıralı [{t(ms), lat, lon, acc, spd?, crs?}] — tek bir kesintisiz hareket parçası.
//   spd: m/s (GPS Doppler hızı), crs: derece (kuzeyden saat yönünde gidiş yönü). İkisi de varsa hız
//   ölçümü olarak kullanılır; yoksa yalnız konumla düzeltilir.
// Dönüş: aynı uzunlukta [{t, lat, lon, v (m/s, düzeltilmiş hız), acc}]
export function smoothTrack(pts) {
  const n = pts.length;
  if (n < 3) return pts.map((p) => ({ ...p, v: p.spd != null ? p.spd : 0 }));
  const { x, y, back } = toXY(pts);
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = (pts[i].t - pts[0].t) / 1000;
  // hız ölçümleri (varsa)
  const zvx = new Float64Array(n), zvy = new Float64Array(n), rv2 = new Float64Array(n);
  let nv = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (p.spd != null && p.spd >= 0 && p.crs != null && p.crs >= 0) {
      zvx[i] = p.spd * Math.sin(p.crs * RAD); zvy[i] = p.spd * Math.cos(p.crs * RAD); rv2[i] = SM.SIGMA_V * SM.SIGMA_V; nv++;
    } else if (p.spd != null && p.spd >= 0 && p.spd < 0.3) {
      zvx[i] = 0; zvy[i] = 0; rv2[i] = SM.SIGMA_V * SM.SIGMA_V; nv++; // duruyor: yön bilinmese de hız ≈ 0
    } else rv2[i] = NaN;
  }
  const hasV = nv >= n * 0.6; // noktaların çoğunda hız varsa hız-destekli kip
  const sig = new Float64Array(n), r2 = new Float64Array(n), q = new Float64Array(n);
  for (let i = 0; i < n; i++) { sig[i] = Math.max(SM.MIN_SIGMA, (pts[i].acc || 15) * (hasV ? SM.SIGMA_K_V : SM.SIGMA_K)); r2[i] = sig[i] * sig[i]; }
  const aOf = (v) => (hasV ? SM.A_WITH_V : Math.min(SM.A_MAX, SM.A_BASE + SM.A_PER_V * v));
  for (let i = 0; i < n; i++) { const a = aOf(pts[i].spd != null && pts[i].spd >= 0 ? pts[i].spd : 1.4); q[i] = a * a; }
  let X, Y;
  for (let pass = 0; pass < SM.PASSES; pass++) {
    X = rts1(x, t, r2, q, hasV ? zvx : null, rv2); Y = rts1(y, t, r2, q, hasV ? zvy : null, rv2);
    if (pass === SM.PASSES - 1) break;
    for (let i = 0; i < n; i++) {
      // aykırı nokta: artık büyükse ölçüm gürültüsünü o kadar büyüt (Huber ağırlığı)
      const e = Math.hypot(x[i] - X.xs[i], y[i] - Y.xs[i]), lim = SM.HUBER_C * sig[i];
      const s = e > lim ? sig[i] * (e / lim) : sig[i];
      r2[i] = s * s;
      // ivme gürültüsünü düzeltilmiş hıza göre güncelle
      const a = aOf(Math.hypot(X.vs[i], Y.vs[i]));
      q[i] = a * a;
    }
  }
  const out = new Array(n);
  for (let i = 0; i < n; i++) { const ll = back(X.xs[i], Y.xs[i]); out[i] = { t: pts[i].t, lat: ll.lat, lon: ll.lon, v: Math.hypot(X.vs[i], Y.vs[i]), acc: pts[i].acc, spd: pts[i].spd }; }
  return out;
}

// Douglas–Peucker: eps metreden az sapan ara noktaları atar. Dönüş: korunan noktaların indeksleri.
export function simplifyIdx(pts, eps) {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const { x, y } = toXY(pts);
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const dx = x[b] - x[a], dy = y[b] - y[a], len = Math.hypot(dx, dy) || 1e-9;
    let worst = -1, wd = eps;
    for (let i = a + 1; i < b; i++) {
      // noktanın a–b doğru parçasına uzaklığı (uçların dışına düşerse uca uzaklık)
      const u = ((x[i] - x[a]) * dx + (y[i] - y[a]) * dy) / (len * len);
      const d = u <= 0 ? Math.hypot(x[i] - x[a], y[i] - y[a]) : u >= 1 ? Math.hypot(x[i] - x[b], y[i] - y[b]) : Math.abs((x[i] - x[a]) * dy - (y[i] - y[a]) * dx) / len;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  const idx = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  return idx;
}

// Çizgi uzunluğu (m)
export function pathLen(pts) {
  if (pts.length < 2) return 0;
  const { x, y } = toXY(pts);
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  return s;
}
