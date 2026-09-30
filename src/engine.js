// İZ — analiz motoru (saf JS, cihazdan bağımsız; node ile test edilir).
// Ham GPS noktaları -> duraklar (stay) + yolculuklar (trip) + ulaşım türü + yerler + rutinler.
// Nokta biçimi: { t: ms, lat, lon, acc?: metre, spd?: m/s }

// ---- Eşikler (tek yerde; sahada ayarlanacak değerler) ----
export const CFG = {
  R_STAY: 60,             // m — bu yarıçap içinde kalınırsa "aynı yerde"
  R_GAP_STAY: 250,        // m — uzun sessizlikten sonra bu kadar kayma hâlâ "durma" sayılır
  MIN_STAY: 5 * 60e3,     // ms — en kısa durak
  R_PLACE: 150,           // m — durakları aynı "yer"e bağlama yarıçapı
  MIN_TRIP_DIST: 80,      // m — daha kısa hareket yolculuk sayılmaz
  BLIND_MIN_DT: 90e3,     // ms — GPS'siz (kör) parça için en kısa sessizlik
  BLIND_MIN_D: 400,       // m
  BLIND_MIN_V: 3.3,       // m/s (12 km/s) — kör parçanın araç sayılması için
  BLIND_MAX_DT: 90 * 60e3,// ms — bundan uzun sessizlik "veri yok"tur
  WALK_V: 2.2,            // m/s (8 km/s) — altı yaya hızı
  BIKE_P90: 7,            // m/s (25 km/s) — hızlı parçanın tepe hızı bunun altındaysa bisiklet
  BIKE_AVG: 5,            // m/s (18 km/s)
  METRO_MIN_D: 800,       // m — kör parçanın metro sayılması için en kısa mesafe
  SHORT_RUN: 120e3,       // ms — bundan kısa hız parçası komşusuna katılır
  WAIT_MAX: 5 * 60e3,     // ms — araçlar arasında bu kadar yavaşlık "bekleme"dir (yaya değil)
  MAX_V: 70,              // m/s — üstü GPS sıçramasıdır, atılır
  MAX_ACC: 100,           // m — daha kötü doğruluklu nokta atılır
};

export const MODES = ['walk', 'bike', 'car', 'metro'];

// ---- Geometri / zaman yardımcıları ----
const RAD = Math.PI / 180;
export function hav(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(s));
}
export function dayStart(t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
export function addDays(t, n) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); }
const minOfDay = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };

// [t0,t1] aralığının, her günün [h0,h1) saat penceresiyle kesişimi (ms). weekdayOnly: Pzt–Cum.
function overlapDaily(t0, t1, h0, h1, weekdayOnly) {
  let sum = 0;
  for (let d = dayStart(t0); d < t1; d = addDays(d, 1)) {
    const wd = new Date(d).getDay();
    if (weekdayOnly && (wd === 0 || wd === 6)) continue;
    const a = Math.max(t0, d + h0 * 3600e3), b = Math.min(t1, d + h1 * 3600e3);
    if (b > a) sum += b - a;
  }
  return sum;
}

// ---- 1) Temizlik: sırala, kötü doğruluk ve ışınlanma sıçramalarını at ----
export function clean(raw) {
  const pts = raw.filter((p) => p && isFinite(p.lat) && isFinite(p.lon) && !(p.acc > CFG.MAX_ACC)).sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q) {
      const dt = (p.t - q.t) / 1000;
      if (dt < 1) continue;
      if (hav(q, p) / dt > CFG.MAX_V) continue;
    }
    out.push(p);
  }
  return out;
}

// İki ardışık nokta arasındaki parça türü:
//  'move'    normal kayıt
//  'blind'   GPS yokken araçla gidilmiş (tünel/metro adayı)
//  'unknown' veri yok (telefon kapalı / uygulama kapatılmış) — tahmin yürütülmez
function segKind(a, b) {
  const dt = b.t - a.t, d = hav(a, b), v = d / (dt / 1000);
  if (dt >= CFG.MIN_STAY && d > CFG.R_GAP_STAY) {
    return v >= CFG.BLIND_MIN_V && dt <= CFG.BLIND_MAX_DT ? 'blind' : 'unknown';
  }
  if (dt >= CFG.BLIND_MIN_DT && d >= CFG.BLIND_MIN_D && v >= CFG.BLIND_MIN_V) return 'blind';
  return 'move';
}

// ---- 2) Durak bulma ----
// Hareketsizken iOS nokta göndermez; bu yüzden "uzun sessizlik + az kayma" da durak sayılır.
function findStays(p) {
  const stays = [];
  let i = 0;
  while (i < p.length) {
    let sLat = p[i].lat, sLon = p[i].lon, cnt = 1, j = i + 1;
    while (j < p.length) {
      const c = { lat: sLat / cnt, lon: sLon / cnt };
      const dt = p[j].t - p[j - 1].t;
      const near = hav(c, p[j]) <= CFG.R_STAY || (dt >= CFG.MIN_STAY && hav(p[j - 1], p[j]) <= CFG.R_GAP_STAY);
      if (!near) break;
      sLat += p[j].lat; sLon += p[j].lon; cnt++; j++;
    }
    if (p[j - 1].t - p[i].t >= CFG.MIN_STAY) {
      stays.push({ a: i, b: j - 1, lat: sLat / cnt, lon: sLon / cnt });
      i = j; // son durak noktası (j-1) sonraki yolculuğun ilk noktası olur (buildItems)
    } else i++;
  }
  return stays;
}

function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// ---- 3) Yolculuk: hız parçalarına böl, her parçaya ulaşım türü ver ----
function makeTrip(p, a, b) {
  const segs = [];
  for (let k = a; k < b; k++) segs.push({ d: hav(p[k], p[k + 1]), dt: p[k + 1].t - p[k].t, kind: segKind(p[k], p[k + 1]) });
  const dist = segs.reduce((s, x) => s + x.d, 0);
  if (dist < CFG.MIN_TRIP_DIST) return null;

  // Pencere hızı (~40 sn): tek tek nokta gürültüsünü bastırır. Kör parçalar pencereye girmez.
  segs.forEach((s, k) => {
    if (s.kind === 'blind') { s.ws = s.d / (s.dt / 1000); return; }
    let d = s.d, dt = s.dt, l = k - 1, r = k + 1;
    while (dt < 40e3) {
      const L = l >= 0 && segs[l].kind !== 'blind', R = r < segs.length && segs[r].kind !== 'blind';
      if (!L && !R) break;
      if (L) { d += segs[l].d; dt += segs[l].dt; l--; }
      if (R) { d += segs[r].d; dt += segs[r].dt; r++; }
    }
    s.ws = d / (dt / 1000);
  });

  // Sınıf: B=kör, S=yavaş (yaya hızı), F=hızlı. Ardışık aynı sınıflar tek "koşu" olur.
  const cls = (s) => (s.kind === 'blind' ? 'B' : s.ws < CFG.WALK_V ? 'S' : 'F');
  let runs = segs.map((s, k) => ({ c: cls(s), a: k, b: k, d: s.d, dt: s.dt }));
  const coalesce = (key) => {
    const out = [];
    for (const r of runs) {
      const q = out[out.length - 1];
      if (q && q[key] === r[key]) { q.b = r.b; q.d += r.d; q.dt += r.dt; } else out.push({ ...r });
    }
    runs = out;
  };
  coalesce('c');
  // Kısa koşuları (ışıkta durma, anlık hızlanma) daha uzun komşusuna kat.
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (r.c === 'B' || r.dt >= CFG.SHORT_RUN) continue;
      const cand = [runs[i - 1], runs[i + 1]].filter((x) => x && x.c !== 'B');
      if (!cand.length) continue;
      r.c = cand.sort((x, y) => y.dt - x.dt)[0].c;
      coalesce('c'); changed = true; break;
    }
  }

  // Koşu -> tür
  for (const r of runs) {
    r.avg = r.d / (r.dt / 1000);
    if (r.c === 'S') r.mode = 'walk';
    else if (r.c === 'B') r.mode = r.d >= CFG.METRO_MIN_D ? 'metro' : 'car';
    else {
      const ws = []; for (let k = r.a; k <= r.b; k++) ws.push(segs[k].ws);
      r.mode = quantile(ws, 0.9) < CFG.BIKE_P90 && r.avg < CFG.BIKE_AVG ? 'bike' : 'car';
    }
  }
  // Kör parça arabayla komşuysa: tünel mi, yer üstüne çıkan metro mu? Mesafe oranına bak.
  runs.forEach((r, i) => {
    if (r.c !== 'B' || r.mode !== 'metro') return;
    const nb = [runs[i - 1], runs[i + 1]].filter((x) => x && x.c === 'F' && x.mode === 'car');
    if (!nb.length) return;
    const nd = nb.reduce((s, x) => s + x.d, 0);
    if (r.d >= 2 * nd) nb.forEach((x) => { x.mode = 'metro'; }); else r.mode = 'car';
  });
  // İki araç parçası arasındaki kısa/yerinde yavaşlık = bekleme (trafik, durak) -> araca kat.
  runs.forEach((r, i) => {
    const L = runs[i - 1], R = runs[i + 1];
    if (r.mode !== 'walk' || !L || !R || L.mode === 'walk' || R.mode === 'walk') return;
    if (r.dt < CFG.WAIT_MAX || r.avg < 0.55) r.mode = L.d >= R.d ? L.mode : R.mode;
  });
  coalesce('mode');

  const legs = runs.map((r) => ({
    mode: r.mode, a: r.a, b: r.b + 1, // b: nokta indeksi (yolculuk içi, dahil)
    t0: p[a + r.a].t, t1: p[a + r.b + 1].t, dist: r.d, dur: r.dt, avg: r.d / (r.dt / 1000),
  }));
  const byMode = {};
  legs.forEach((l) => { byMode[l.mode] = (byMode[l.mode] || 0) + l.dist; });
  const mode = Object.keys(byMode).sort((x, y) => byMode[y] - byMode[x])[0];
  const dur = p[b].t - p[a].t;
  return {
    type: 'trip', t0: p[a].t, t1: p[b].t, dist, dur, mode, legs,
    avg: dist / (dur / 1000),
    // tepe hız: pencere hızlarının %95'i; kör (metro) parça tek segment olduğundan parça ortalamaları da sayılır
    max: Math.max(quantile(segs.map((s) => s.ws), 0.95), ...legs.map((l) => l.avg)),
    pts: p.slice(a, b + 1),
  };
}

// ---- 4) Zaman çizelgesi: durak / yolculuk / veri-yok sırası ----
export function segment(points) {
  const p = points, items = [];
  if (p.length < 2) return items;
  const pushTrips = (a, b) => {
    let start = a;
    for (let k = a; k < b; k++) {
      if (segKind(p[k], p[k + 1]) !== 'unknown') continue;
      if (k > start) { const t = makeTrip(p, start, k); if (t) items.push(t); }
      items.push({ type: 'gap', t0: p[k].t, t1: p[k + 1].t });
      start = k + 1;
    }
    if (b > start) { const t = makeTrip(p, start, b); if (t) items.push(t); }
  };
  let cur = 0;
  for (const s of findStays(p)) {
    if (s.a > cur) pushTrips(cur, s.a);
    const prev = items[items.length - 1];
    // Aradaki hareket yolculuk sayılmayacak kadar kısaysa ve aynı yerse: durakları birleştir.
    if (prev && prev.type === 'stay' && hav(prev, s) < 200) {
      const w1 = prev.t1 - prev.t0, w2 = p[s.b].t - p[s.a].t;
      prev.lat = (prev.lat * w1 + s.lat * w2) / (w1 + w2); prev.lon = (prev.lon * w1 + s.lon * w2) / (w1 + w2);
      prev.t1 = p[s.b].t;
    } else items.push({ type: 'stay', t0: p[s.a].t, t1: p[s.b].t, lat: s.lat, lon: s.lon });
    cur = s.b;
  }
  if (cur < p.length - 1) pushTrips(cur, p.length - 1);
  return items;
}

// ---- 5) Yerler: durakları kümele, ev/iş bul ----
function buildPlaces(stays, saved, from, to, detect, hints) {
  const places = saved.map((s) => ({ id: 's' + s.id, saved: s, lat: s.lat, lon: s.lon, name: s.name, kind: s.kind || null, addr: s.addr }));
  let n = 0;
  const fresh = (st) => { const pl = { id: 'n' + n++, lat: st.lat, lon: st.lon, w: 0, kind: null }; places.push(pl); return pl; };
  for (const st of [...stays].sort((x, y) => (y.t1 - y.t0) - (x.t1 - x.t0))) {
    let best = null, bd = CFG.R_PLACE;
    for (const pl of places) { const d = hav(pl, st); if (d <= bd) { bd = d; best = pl; } }
    const pl = best || fresh(st);
    if (!pl.saved) { // kaydedilmemiş yerin merkezi süre-ağırlıklı ortalama
      const w = st.t1 - st.t0;
      pl.lat = (pl.lat * pl.w + st.lat * w) / (pl.w + w); pl.lon = (pl.lon * pl.w + st.lon * w) / (pl.w + w); pl.w += w;
    }
    st.place = pl;
  }
  for (const pl of places) { pl.total = 0; pl.visits = 0; pl.night = 0; pl.work = 0; pl.daySet = new Set(); pl.wdSet = new Set(); }
  for (const st of stays) {
    const a = Math.max(st.t0, from), b = Math.min(st.t1, to);
    if (b <= a) continue;
    const pl = st.place;
    pl.total += b - a; pl.visits++;
    pl.night += overlapDaily(a, b, 0, 6, false);
    const w = overlapDaily(a, b, 10, 17, true);
    pl.work += w;
    for (let d = dayStart(a); d < b; d = addDays(d, 1)) pl.daySet.add(d);
    if (w > 3600e3) pl.wdSet.add(dayStart(a));
  }
  const used = places.filter((pl) => pl.total > 0);
  // Kullanıcının elle verdiği tür her zaman önceliklidir; yoksa ipucu, o da yoksa otomatik tespit.
  for (const kind of ['home', 'work']) {
    if (places.some((pl) => pl.saved && pl.saved.kind === kind)) continue;
    const h = hints && hints[kind];
    let pick = h ? used.find((pl) => !pl.kind && hav(pl, h) <= CFG.R_PLACE) : null;
    if (!pick && detect) {
      const cand = used.filter((pl) => !pl.kind);
      pick = kind === 'home'
        ? cand.filter((pl) => pl.night >= 2 * 3600e3).sort((x, y) => y.night - x.night)[0]
        : cand.filter((pl) => pl.work >= 3 * 3600e3 && pl.wdSet.size >= 2).sort((x, y) => y.work - x.work)[0];
    }
    if (pick) { pick.kind = kind; pick.auto = true; }
  }
  used.sort((x, y) => y.total - x.total);
  let k = 1;
  for (const pl of used) {
    pl.days = pl.daySet.size;
    if (!pl.name) pl.name = pl.kind === 'home' ? 'Ev' : pl.kind === 'work' ? 'İş' : pl.addr || 'Konum ' + k++;
  }
  return used;
}

// ---- 6) Rutinler: önemli yerler arası A→B; çıkış ve varış saat aralıkları ----
function buildRoutines(items, places) {
  const sig = new Set(places.filter((pl) => pl.kind === 'home' || pl.kind === 'work' || (pl.visits >= 2 && pl.total >= 30 * 60e3)).slice(0, 8));
  const journeys = [];
  let last = null, modes = {}, stops = 0, broken = false;
  for (const it of items) {
    if (it.type === 'gap') broken = true;
    else if (it.type === 'trip') modes[it.mode] = (modes[it.mode] || 0) + it.dist;
    else if (!sig.has(it.place)) stops++; // önemsiz ara durak (market, benzinlik)
    else {
      if (last && last.place !== it.place && !broken && it.t0 - last.t1 < 4 * 3600e3) {
        const mode = Object.keys(modes).sort((x, y) => modes[y] - modes[x])[0] || null;
        journeys.push({ from: last.place, to: it.place, dep: last.t1, arr: it.t0, dur: it.t0 - last.t1, stops, mode });
      }
      last = it; modes = {}; stops = 0; broken = false;
    }
  }
  const groups = {};
  for (const j of journeys) (groups[j.from.id + '>' + j.to.id] = groups[j.from.id + '>' + j.to.id] || []).push(j);
  const stat = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr), avg: Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) });
  return Object.values(groups).filter((g) => g.length >= 2).map((g) => {
    const mc = {}; g.forEach((j) => { if (j.mode) mc[j.mode] = (mc[j.mode] || 0) + 1; });
    return {
      from: g[0].from, to: g[0].to, count: g.length, list: g,
      dep: stat(g.map((j) => minOfDay(j.dep))), arr: stat(g.map((j) => minOfDay(j.arr))), // gün içi dakika
      dur: stat(g.map((j) => j.dur)), mode: Object.keys(mc).sort((x, y) => mc[y] - mc[x])[0] || null,
    };
  }).sort((x, y) => y.count - x.count);
}

// ---- Ana giriş ----
// rawPoints: [from - 1 gün, to + 1 gün] aralığını kapsamalı (gece yarısını aşan duraklar için).
// opt: { from, to, saved: kayıtlı yerler, overrides: {t0: mode}, now: kayıt açıksa şimdiki zaman,
//        detect: ev/iş otomatik bulunsun mu, hints: {home:{lat,lon}, work:{lat,lon}} }
export function analyze(rawPoints, opt) {
  const { from, to, saved = [], overrides = {}, now, detect = false, hints } = opt;
  const p = clean(rawPoints);
  // Ham iz: aralıktaki TÜM kayıtlı noktalar, durak/yolculuk ayrımından bağımsız (kısa hareketler,
  // durak içi dolaşma dahil). Haritada ince çizgi olarak çizilir. GPS'siz/veri-yok parçalarda bölünür;
  // Bina içinde doğruluk 30–65 m olur; bu noktalar da çizilir (yoksa içeride hiç iz görünmez).
  const track = [];
  let curLine = null, prevPt = null;
  for (const q of p) {
    if (q.t < from || q.t >= to) continue;
    if (!curLine || segKind(prevPt, q) !== 'move') { curLine = []; track.push(curLine); }
    curLine.push(q); prevPt = q;
  }
  const nPoints = p.filter((q) => q.t >= from && q.t < to).length;
  const lastT = p.length ? p[p.length - 1].t : null;
  const lastPt = p.length ? { ...p[p.length - 1] } : null; // canlı konum gelmezse haritadaki nokta için
  // Kayıt açık ve son nokta eskiyse: hâlâ orada duruyoruz (hareketsizken nokta gelmez).
  if (now && p.length && now - p[p.length - 1].t >= CFG.MIN_STAY) p.push({ ...p[p.length - 1], t: now });
  const all = segment(p);

  const ovKeys = Object.keys(overrides).map(Number);
  for (const it of all) {
    if (it.type !== 'trip') continue;
    const k = ovKeys.find((t) => Math.abs(t - it.t0) <= 120e3);
    if (k !== undefined) { it.autoMode = it.mode; it.mode = overrides[k]; it.overridden = true; }
  }
  const places = buildPlaces(all.filter((x) => x.type === 'stay'), saved, from, to, detect, hints);

  // Aralığa kırp: duraklar kesilir, yolculuk başlangıç anına göre sayılır.
  const items = [];
  for (const it of all) {
    if (it.type === 'trip') { if (it.t0 >= from && it.t0 < to) items.push(it); continue; }
    const a = Math.max(it.t0, from), b = Math.min(it.t1, to);
    if (b > a) items.push({ ...it, t0: a, t1: b, full0: it.t0, full1: it.t1 });
  }

  const emptyModes = () => Object.fromEntries(MODES.map((m) => [m, { dist: 0, dur: 0 }]));
  const totals = { modes: emptyModes(), dist: 0, moveMs: 0, stayMs: 0, trips: 0 };
  const days = [];
  for (let d = dayStart(from); d < to; d = addDays(d, 1)) days.push({ day: d, modes: emptyModes(), dist: 0, moveMs: 0, places: {} });
  const dayOf = (t) => days.find((x) => t >= x.day && t < addDays(x.day, 1));
  for (const it of items) {
    if (it.type === 'trip') {
      const D = dayOf(it.t0);
      totals.trips++; totals.dist += it.dist; totals.moveMs += it.dur;
      if (D) { D.dist += it.dist; D.moveMs += it.dur; }
      // Elle düzeltilmiş yolculuk tek tür sayılır; yoksa parça parça (yürü+metro+yürü).
      const parts = it.overridden ? [{ mode: it.mode, dist: it.dist, dur: it.dur }] : it.legs;
      for (const l of parts) {
        totals.modes[l.mode].dist += l.dist; totals.modes[l.mode].dur += l.dur;
        if (D) { D.modes[l.mode].dist += l.dist; D.modes[l.mode].dur += l.dur; }
      }
    } else if (it.type === 'stay') {
      totals.stayMs += it.t1 - it.t0;
      for (const D of days) {
        const a = Math.max(it.t0, D.day), b = Math.min(it.t1, addDays(D.day, 1));
        if (b > a) D.places[it.place.id] = (D.places[it.place.id] || 0) + (b - a);
      }
    }
  }
  return { items, places, routines: buildRoutines(items, places), days, totals, track: track.filter((l) => l.length > 1), nPoints, lastT, lastPt };
}
