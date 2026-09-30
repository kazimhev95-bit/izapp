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
// Amaç: çizgi yolun ŞEKLİNİ alsın (düz yolda düz, köşede köşe) ama gerçek izden kopmasın.
//  1) Koridor öbeği: yol çizgisine koridor mesafesi içinde kalan, ardışık en az RUN_N nokta "o yolda gidiyor"
//     demektir. Öbekteki her nokta yola izdüşürülür ve yolun yanına, izin o bölgedeki ortalama yan uzaklığıyla
//     (±6 nokta, uçları kırpılmış ortalama) kaydırılır. Bu uzaklık yayada en çok SIDE (12 m), araçta 0:
//     • yayada bina kenarındaki GPS kayması (hep aynı yana 15-25 m — 30 Eyl Süleyman Vəzirov) kırpılır ama
//       kaldırım tarafı korunur; geniş caddede sunucunun seçtiği karşı kenara atlamaz (Bakıxanov prospekti),
//     • araçta çizgi tam yola oturur.
//  2) Öbek dışı: yakın/uzak kuralı — yola ≤ NEAR nokta oturur, ≥ FAR kalır, arası kısmen (kayma MOVE ile
//     sınırlı). Sunucunun dolambaçlı eşleştirmesi böylece izlenmez.
//  3) Ardışık iki öbek noktası aynı yol çizgisinde ileri gidiyorsa aradaki yol köşeleri (aynı yan uzaklıkla)
//     eklenir — seyrek noktada köşe kesilmesin; yalnız o aradaki yol dolambaç değilse.
// Kaba noktada (otobüs içi ±40-80 m) izin kendisi de belirsizdir: eşikler noktanın doğruluğuyla büyür.
// pts: [{lat, lon, acc}] (parçanın düzeltilmiş noktaları), parts: sunucunun çizgileri [{g, c: [[lat, lon], ...]}]
// Dönüş: {pts: [{lat, lon, via}] (via: bu noktadan ÖNCE eklenecek yol köşeleri), d: çizgi uzunluğu (m)}
const FUSE = { walk: [10, 25, 12], bike: [10, 25, 12], car: [15, 40, 17], bus: [15, 40, 17] };     // öbek dışı [NEAR, FAR, MOVE] m
// [taban, tavan, en az nokta, SIDE, doğruluk çarpanı]. Araçta iyi GPS'le koridor dar (25 m): noktalar yola
// 25 m'den uzak ve iyiyse eşleştirme yanlış sokağı seçmiş olabilir — oraya yapıştırma.
const CORR = { walk: [28, 35, 4, 12, 1.2], bike: [28, 35, 4, 12, 1.2], car: [25, 70, 3, 0, 1.5], bus: [25, 70, 3, 0, 1.5] };
// Köşe ekleme payı: yol yayı ≤ oran × kiriş + pay (araçta seyrek noktada L köşe ~1,41 oran ister)
const VIA = { walk: [1.3, 8], bike: [1.3, 8], car: [1.5, 20], bus: [1.5, 20] };
const M_DEG = 111320; // m / enlem derecesi

export function fuseSnap(pts, parts, mode) {
  const [NEAR0, FAR0, MOVE0] = FUSE[mode] || FUSE.walk, [VR, VS] = VIA[mode] || VIA.walk, [C0, C1, RUN_N, SIDE, CK] = CORR[mode] || CORR.walk;
  const lat0 = pts[0].lat, lon0 = pts[0].lon, kx = Math.cos((lat0 * Math.PI) / 180);
  const X = (la, lo) => [(lo - lon0) * M_DEG * kx, (la - lat0) * M_DEG];
  const back = (x, y) => ({ lat: lat0 + y / M_DEG, lon: lon0 + x / (M_DEG * kx) });
  // Yol çizgileri: yalnız sürekli parçalar (g=1 boşluk bağlantısı yol değildir).
  // s: çizgi boyunca konum (m); n: her kesimin sol normali (yan kaydırma için)
  const lines = parts.filter((p) => !p.g && p.c.length >= 2).map((p) => {
    const xy = p.c.map(([la, lo]) => X(la, lo)), s = [0], n = [];
    for (let i = 1; i < xy.length; i++) {
      const dx = xy[i][0] - xy[i - 1][0], dy = xy[i][1] - xy[i - 1][1], l = Math.hypot(dx, dy) || 1;
      s.push(s[i - 1] + l); n.push([-dy / l, dx / l]);
    }
    return { xy, s, n };
  });
  // Her noktanın yol çizgisine en yakın izdüşümü + işaretli yan uzaklığı (solda +)
  const P = pts.map((q) => {
    const [x, y] = X(q.lat, q.lon);
    let b = null;
    lines.forEach((L, li) => {
      for (let i = 0; i < L.xy.length - 1; i++) {
        const [ax, ay] = L.xy[i], [bx, by] = L.xy[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const px = ax + u * dx, py = ay + u * dy, d = Math.hypot(x - px, y - py);
        if (!b || d < b.d) b = { d, li, i, px, py, s: L.s[i] + u * Math.sqrt(l2), off: (x - px) * L.n[i][0] + (y - py) * L.n[i][1] };
      }
    });
    return { x, y, b };
  });
  const acc = (i) => pts[i].acc || 0;
  // 1) Koridor öbekleri
  const run = new Array(P.length).fill(-1);
  for (let i = 0, id = 0; i < P.length;) {
    const inC = (k) => !!P[k].b && P[k].b.d <= Math.min(C1, Math.max(C0, CK * acc(k)));
    if (!inC(i)) { i++; continue; }
    let j = i;
    while (j + 1 < P.length && inC(j + 1)) j++;
    if (j - i + 1 >= RUN_N) { for (let k = i; k <= j; k++) run[k] = id; id++; }
    i = j + 1;
  }
  // Öbek içi yan uzaklık: ±6 komşunun uçları kırpılmış ortalaması, SIDE ile sınırlı
  const side = P.map((p, i) => {
    if (run[i] < 0 || !SIDE) return 0;
    const v = [];
    for (let j = Math.max(0, i - 6); j <= Math.min(P.length - 1, i + 6); j++) if (run[j] === run[i]) v.push(P[j].b.off);
    v.sort((x, y) => x - y);
    const cut = Math.floor(v.length * 0.2), mid = v.slice(cut, v.length - cut);
    const m = mid.reduce((x, y) => x + y, 0) / mid.length;
    return Math.max(-SIDE, Math.min(SIDE, m));
  });
  // 2) Öbek dışı: yakın/uzak kuralı, ±2 komşu ortalaması, kayma sınırlı
  const w0 = P.map(({ b }, i) => {
    if (!b) return 0;
    const NEAR = Math.max(NEAR0, 0.8 * acc(i)), FAR = Math.max(FAR0, 1.6 * acc(i));
    return b.d <= NEAR ? 1 : b.d >= FAR ? 0 : (FAR - b.d) / (FAR - NEAR);
  });
  const w = w0.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(w0.length - 1, i + 2); j++) { s += w0[j]; n++; }
    const b = P[i].b, MOVE = Math.max(MOVE0, acc(i));
    return b && b.d > 0 ? Math.min(s / n, MOVE / b.d) : s / n;
  });
  // Bir yol köşesinin kaydırma yönü: iki komşu kesimin normallerinin ortası
  const vNorm = (L, k) => {
    const a = L.n[Math.max(0, k - 1)], c = L.n[Math.min(L.n.length - 1, k)], nx = a[0] + c[0], ny = a[1] + c[1], l = Math.hypot(nx, ny) || 1;
    return [nx / l, ny / l];
  };
  const out = [];
  let d = 0, prev = null;
  P.forEach((p, i) => {
    let x, y;
    const inRun = run[i] >= 0;
    if (inRun) { const L = lines[p.b.li], nn = L.n[p.b.i]; x = p.b.px + side[i] * nn[0]; y = p.b.py + side[i] * nn[1]; }
    else if (p.b) { x = p.x + w[i] * (p.b.px - p.x); y = p.y + w[i] * (p.b.py - p.y); }
    else { x = p.x; y = p.y; }
    const via = [];
    // 3) Aynı öbekte, aynı yol çizgisinde ileri giden iki nokta arasındaki yol köşeleri (dolambaç değilse)
    if (inRun && prev && prev.run === run[i] && prev.b.li === p.b.li && p.b.s > prev.b.s) {
      const L = lines[p.b.li], chord = Math.hypot(p.b.px - prev.b.px, p.b.py - prev.b.py), o = (side[i] + prev.side) / 2;
      if (p.b.s - prev.b.s <= chord * VR + VS) for (let k = prev.b.i + 1; k <= p.b.i; k++) {
        const [nx, ny] = vNorm(L, k), v = back(L.xy[k][0] + o * nx, L.xy[k][1] + o * ny);
        via.push([v.lat, v.lon]);
      }
    }
    // uzunluk: önceki noktadan köşeler üzerinden bu noktaya
    let lx = prev ? prev.x : x, ly = prev ? prev.y : y;
    for (const v of via) { const [vx, vy] = X(v[0], v[1]); d += Math.hypot(vx - lx, vy - ly); lx = vx; ly = vy; }
    d += Math.hypot(x - lx, y - ly);
    const q = back(x, y);
    out.push({ lat: q.lat, lon: q.lon, via: via.length ? via : null });
    prev = { x, y, b: p.b, run: run[i], side: side[i] };
  });
  return { pts: out, d };
}
