// Yola oturtmanın saf kısmı (ağ ve depo yok — Node testlerinde de çalışır). Ağ/depo tarafı: snap.js
export const SNAP_V = 1; // önbellek sürümü: eşleştirme kuralları değişirse artır → tüm parçalar yeniden sorulur

// Yola oturtulan türler. Metro yer altında gider (yolu yok); tahmini parçalar zaten GPS'siz.
export const SNAP_MODES = { walk: 1, bike: 1, car: 1, bus: 1 };
const MIN_D = 60;          // m — daha kısa parçayı sormaya değmez
const SETTLE_MS = 3 * 60e3; // son 3 dk'da biten parça sürüyor olabilir (nokta gelmeye devam eder) → bekle

// Parçanın önbellek anahtarı: sürüm + tür + zaman aralığı + nokta sayısı (parça büyürse değişir)
export const snapKey = (leg) => SNAP_V + ':' + leg.mode + ':' + leg.t0 + ':' + leg.t1 + ':' + (leg.b - leg.a);

// Sunucuya sorulacak parçalar ve gövdeleri. known(k): anahtar önbellekte var mı (varsa bir daha sorulmaz).
// Nokta biçimi: [lat, lon, t (sn), acc (m)] — yapay çıkış noktaları (motorun tahmini) gönderilmez.
export function snapCandidates(items, now, known) {
  const out = [];
  for (const it of items) {
    if (it.type !== 'trip' || !it.raw) continue;
    for (const leg of it.legs) {
      if (!SNAP_MODES[leg.mode] || leg.est || leg.dist < MIN_D || now - leg.t1 < SETTLE_MS) continue;
      const k = snapKey(leg);
      if (known(k)) continue;
      const p = [];
      for (let i = leg.a; i <= leg.b; i++) {
        const q = it.raw[i];
        if (q && !q.syn) p.push([+q.lat.toFixed(6), +q.lon.toFixed(6), Math.round(q.t / 100) / 10, q.acc == null ? null : Math.round(q.acc)]);
      }
      if (p.length >= 3) out.push({ k, leg: { id: k, m: leg.mode, p } });
    }
  }
  return out;
}

// ---- Yol çizgisini gerçek izle birleştirme ----
// Kural: son çizgi gerçek izden (yerel düzeltilmiş noktalar — haritadaki turuncu iz) hiçbir yerde
// MOVE metreden fazla uzaklaşmaz. Sunucunun yol çizgisi yalnız bir "çekim hattı"dır:
//  • nokta yola NEAR metreden yakınsa yola oturur (düz yolda zikzak kalkar),
//  • FAR metreden uzaksa kendi yerinde kalır (orada eşleştirme güvenilmez: dolambaç, eksik harita, kaldırım),
//  • arada kısmen çekilir; çekme oranı komşu noktalarla yumuşatılır (testere dişi olmasın).
//  • ardışık iki tam oturmuş nokta arasında yol köşe yapıyorsa yolun köşeleri eklenir (seyrek noktada köşe
//    kesilmesin) — yalnız o aradaki yol parçası dolambaç değilse.
// pts: [{lat, lon}] (parçanın düzeltilmiş noktaları), parts: sunucunun çizgileri [{g, c: [[lat, lon], ...]}]
// Dönüş: {pts: [{lat, lon, via}] (via: bu noktadan ÖNCE eklenecek yol köşeleri), d: çizgi uzunluğu (m)}
const FUSE = { walk: [10, 25, 12], bike: [10, 25, 12], car: [15, 40, 17], bus: [15, 40, 17] }; // [NEAR, FAR, MOVE] m
const M_DEG = 111320; // m / enlem derecesi

export function fuseSnap(pts, parts, mode) {
  const [NEAR, FAR, MOVE] = FUSE[mode] || FUSE.walk;
  const lat0 = pts[0].lat, lon0 = pts[0].lon, kx = Math.cos((lat0 * Math.PI) / 180);
  const X = (la, lo) => [(lo - lon0) * M_DEG * kx, (la - lat0) * M_DEG];
  const back = (x, y) => ({ lat: lat0 + y / M_DEG, lon: lon0 + x / (M_DEG * kx) });
  // Yol çizgileri: yalnız sürekli parçalar (g=1 boşluk bağlantısı yol değildir). s: çizgi boyunca konum (m)
  const lines = parts.filter((p) => !p.g && p.c.length >= 2).map((p) => {
    const xy = p.c.map(([la, lo]) => X(la, lo)), s = [0];
    for (let i = 1; i < xy.length; i++) s.push(s[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    return { xy, s };
  });
  // Her noktanın yol çizgisine en yakın izdüşümü
  const P = pts.map((q) => {
    const [x, y] = X(q.lat, q.lon);
    let b = null;
    lines.forEach((L, li) => {
      for (let i = 0; i < L.xy.length - 1; i++) {
        const [ax, ay] = L.xy[i], [bx, by] = L.xy[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const px = ax + u * dx, py = ay + u * dy, d = Math.hypot(x - px, y - py);
        if (!b || d < b.d) b = { d, li, i, px, py, s: L.s[i] + u * Math.sqrt(l2) };
      }
    });
    return { x, y, b };
  });
  // Çekme oranı: NEAR altı 1, FAR üstü 0, arası doğrusal → ±2 komşu ortalaması → kayma MOVE ile sınırlı
  const w0 = P.map(({ b }) => (!b ? 0 : b.d <= NEAR ? 1 : b.d >= FAR ? 0 : (FAR - b.d) / (FAR - NEAR)));
  const w = w0.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(w0.length - 1, i + 2); j++) { s += w0[j]; n++; }
    const b = P[i].b;
    return b && b.d > 0 ? Math.min(s / n, MOVE / b.d) : s / n;
  });
  const out = [];
  let d = 0, prev = null;
  P.forEach((p, i) => {
    const full = w[i] >= 0.99 && p.b;
    const x = full ? p.b.px : p.x + (p.b ? w[i] * (p.b.px - p.x) : 0), y = full ? p.b.py : p.y + (p.b ? w[i] * (p.b.py - p.y) : 0);
    const q = back(x, y), via = [];
    // İki tam oturmuş nokta aynı yol çizgisinde ileri gidiyorsa aradaki yol köşelerini ekle (dolambaç değilse)
    if (full && prev && prev.full && prev.b.li === p.b.li && p.b.s > prev.b.s) {
      const L = lines[p.b.li], chord = Math.hypot(x - prev.x, y - prev.y);
      if (p.b.s - prev.b.s <= chord * 1.25 + 8) for (let k = prev.b.i + 1; k <= p.b.i; k++) { const v = back(L.xy[k][0], L.xy[k][1]); via.push([v.lat, v.lon]); }
    }
    // uzunluk: önceki noktadan köşeler üzerinden bu noktaya
    let lx = prev ? prev.x : x, ly = prev ? prev.y : y;
    for (const v of via) { const [vx, vy] = X(v[0], v[1]); d += Math.hypot(vx - lx, vy - ly); lx = vx; ly = vy; }
    d += Math.hypot(x - lx, y - ly);
    out.push({ lat: q.lat, lon: q.lon, via: via.length ? via : null });
    prev = { x, y, b: p.b, full };
  });
  return { pts: out, d };
}
