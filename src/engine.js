// İZ — analiz motoru (saf JS, cihazdan bağımsız; node ile test edilir).
// Ham GPS noktaları -> duraklar (stay) + yolculuklar (trip) + ulaşım türü + yerler + rutinler.
// Nokta biçimi:   { t: ms, lat, lon, acc?: metre, spd?: m/s, crs?: derece }
// Hareket kaydı:  { t: ms, k: 'A'|'C'|'R'|'W'|'S'|'U', c: 0..2 }  (telefonun hareket işlemcisinden:
//                 A=araçta, C=bisiklet, R=koşu, W=yürüyüş, S=duruyor, U=bilinmiyor; c=güven)
import { smoothTrack } from './smooth.js';
import { fuseSnap } from './snapcore.js';

// ---- Eşikler (tek yerde; sahada ayarlanacak değerler) ----
export const CFG = {
  R_STAY: 60,             // m — bu yarıçap içinde kalınırsa "aynı yerde"
  R_CORE: 20,             // m — durağın çekirdeği: uçlardaki daha uzak noktalar geliş/gidiş yürüyüşüdür
  TRIM_MS: 3 * 60e3,      // ms — durağın başından/sonundan en çok bu kadarı yolculuğa verilir
  R_GAP_STAY: 250,        // m — uzun sessizlikten sonra en çok bu kadar kayma "durup sonra yürümüş" sayılır
  MIN_STAY: 5 * 60e3,     // ms — en kısa durak
  R_PLACE: 150,           // m — durakları aynı "yer"e bağlama yarıçapı
  MIN_TRIP_DIST: 80,      // m — daha kısa hareket yolculuk sayılmaz
  EST_MIN_DT: 45e3,       // ms — iki nokta arası bu kadar sessizlik + EST_MIN_D kayma = kayıt boşluğu (tahmini parça)
  EST_MIN_D: 50,          // m
  EST_WALK_V: 1.4,        // m/s — kayıt boşluğunda "yürüdü" varsayımı için hız
  BLIND_MIN_DT: 90e3,     // ms — GPS'siz (kör) araç parçası için en kısa sessizlik
  BLIND_MIN_D: 400,       // m
  BLIND_MIN_V: 2.0,       // m/s (7 km/s) — kör parçanın araç sayılması için (tıxacda 10 km/s sürünme bölünmesin; yürüyüş 5 km/s)
  BLIND_MAX_DT: 90 * 60e3,// ms — bundan uzun sessizlik "veri yok"tur
  WALK_V: 2.2,            // m/s (8 km/s) — altı yaya hızı
  WALK_ACT_MAX_V: 4.5,    // m/s — hareket işlemcisi "yürüyor/koşuyor" dese de bundan hızlıysa araçtır
  BIKE_P90: 7,            // m/s (25 km/s) — hızlı parçanın tepe hızı bunun altındaysa bisiklet
  BIKE_AVG: 5,            // m/s (18 km/s)
  METRO_MIN_D: 800,       // m — kör parçanın metro sayılması için en kısa mesafe
  SHORT_RUN: 120e3,       // ms — bundan uzun süren hızlı koşu kesin araçtır
  SOLID_D: 200,           // m — daha kısa sürmüşse: en az bu mesafe ve
  SOLID_V: 4,             // m/s (14 km/s) en az bu ortalama hız gerekir (yoksa GPS sıçraması/koşu sayılır)
  SOLID_P90: 4.5,         // m/s — uzun ama ortalaması düşük koşuda (sıkışık trafik) tepe hız en az bu olmalı
  BIKE_STOP_FRAC: 0.25,   // bisiklet sürenin en çok bu kadarında durur; daha çok duruyorsa trafikteki araçtır
  STOP_D: 100,            // m — iki araç koşusu arasında bundan kısa yavaşlık duruştur (yürüyüş değil)
  DOOR_D: 60,             // m — yolculuğun ucunda bundan kısa yürüyüş ayrı parça sayılmaz
  WAIT_MAX: 5 * 60e3,     // ms — araçlar arasında bu kadar yavaşlık "bekleme"dir (yaya değil)
  MAX_V: 70,              // m/s — üstü GPS sıçramasıdır, atılır
  MAX_ACC: 100,           // m — daha kötü doğruluklu nokta atılır
  ACT_VALID: 3 * 60e3,    // ms — bir hareket kaydı en çok bu kadar süre geçerli sayılır
  STOP_V: 1.0,            // m/s — araçta bunun altı "duruş"
  STOP_MIN: 8e3,          // ms — en kısa duruş
  STOP_AVG: 2.5,          // m/s — seyrek noktalarda: uzun parçanın ortalaması bunun altındaysa duruş sayılır
  BUS_MIN_D: 800,         // m — otobüs sayılacak araç parçasının en kısa mesafesi
  PHANTOM_MAX: 15 * 60e3, // ms — aynı yere dönen bundan kısa ve kanıtsız yolculuk hayalettir (GPS sıçraması)
  PHANTOM_D: 1000,        // m — kaba konumlu (±30 m üstü) hayalet adayı en çok bu kadar uzun olabilir
  BUS_STOPS_KM: 1.0,      // km başına duruş (otobüs durak durak gider); iki uçta yürüyüş varsa BUS_STOPS_KM2 yeter
  BUS_STOPS_KM2: 0.6,
  BUS_TAIL_WAIT: 90e3,    // ms — araçtan hemen önceki yürüyüş en az bu kadar yerinde beklemeyle bitiyorsa: durakta bekleme
  BUS_MAX_V: 20,          // m/s (72 km/s) — şehir içi otobüs bundan hızlı gitmez
  BUS_WALK_D: 100,        // m — araçtan önce/sonra en az bu kadar yürüyüş (durağa yürüme)
  BUS_WAIT_MAX: 20 * 60e3,// ms — araçtan önceki kısa durak "durakta bekleme" sayılır
  BUS_WAIT_RATE: 0.5,     // km başına en az bu kadar duruş: otobüs durak durak gider (araba 6,7 km'de 2 kez durdu)
  BUS_STOP_R: 30,         // m — duruş bu kadar yakınsa "otobüs durağında durdu"
  BUS_STOP_N: 3,          // en az bu kadar durakta duruş…
  BUS_STOP_FRAC: 0.5,     // …ve duruşların en az yarısı durakta…
  BUS_STOP_KM: 0.4,       // …ve km başına en az bu kadar durakta duruş → otobüs
  JAM_V: 3.1,             // m/s (11 km/s) — araçta bunun altı "trafikte yavaş" (tıxac süresine sayılır)
  WAIT_R: 15,             // m — yolculuk içinde bu yarıçapta kalınırsa "yerinde bekliyor" (kaba konumda büyür)
  WAIT_MIN: 40e3,         // ms — en kısa bekleme (ışık, durak, yaya bekleme)
  WAIT_B_MAX: 10 * 60e3,  // ms — "yerinde sayma" beklemesi en çok bu kadar (daha uzunu zaten durak olur)
  WALK_MIN_DT: 60e3,      // ms — araçtan inip yürüme: yürüme hızı en az bu kadar sürmeli…
  WALK_MIN_V: 0.6,        // m/s — …ölçülen hız bunun üstünde (yerinde durmak yürüme değil, beklemedir)…
  WALK_MAX_V: 3.5,        // m/s — …ve bu aralıkta hiç araç hızı ölçülmemiş olmalı (trafikte dur-kalk ≠ yürüyüş)
  WALK_GAP: 6000,         // ms — hareket kaydı yokken GPS'e ancak iz kaliteliyse güvenilir: noktalar sık…
  WALK_ACC: 20,           // m — …ve doğru olmalı (otobüste GPS seyrek + kaba: sürünmesi yürüyüş gibi görünür)
};

export const MODES = ['walk', 'bike', 'bus', 'car', 'metro'];

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

function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
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
  // Tek noktalık sıçrama: p1 hem öncekinden hem sonrakinden çok uzak, ama önceki ile sonraki yan yana →
  // telefon yerinde dururken Wi-Fi/baz konumu bir anlığına yüzlerce metre öteyi göstermiş. p1 atılır.
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const a = res[res.length - 1], p = out[i], b = out[i + 1];
    if (a && b && b.t - a.t < 5 * 60e3) {
      const tol = Math.max(50, 2 * (p.acc || 0)), dab = hav(a, b);
      if (hav(a, p) > tol && hav(p, b) > tol && dab < 0.3 * Math.min(hav(a, p), hav(p, b))) continue;
    }
    res.push(p);
  }
  return res;
}

// İki nokta arasındaki kaymanın "gerçek yer değiştirme" sayılması için eşik. Konum kabaysa (bina içi,
// pil tasarrufu kipi: ±65 m) noktalar yerinde dururken de onlarca metre oynar; bu oynama hareket değildir.
const moveMin = (a, b) => Math.max(CFG.EST_MIN_D, (a.acc || 0) + (b.acc || 0));

// Kayıt boşluğunda "durup sonra yürümüş" çıkarımı: uzun sessizlikten sonraki nokta 50–250 m ötedeyse,
// kişi o yerde kalmış ve boşluğun SONUNDA yürüyerek oraya gitmiştir. Çıkış anını mesafe/yürüme hızından
// tahmin edip araya yapay bir "çıkış" noktası koyarız: durak doğru saatte biter, yürüyüş tahmini
// (kesikli) parça olarak görünür. Kayıt kesintisiz çalışırken bu durum oluşmaz.
function inferDepartures(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    if (a && b.t - a.t >= CFG.MIN_STAY) {
      const d = hav(a, b);
      if (d > moveMin(a, b) && d <= CFG.R_GAP_STAY) {
        const t = Math.max(a.t + 1000, b.t - (d / CFG.EST_WALK_V) * 1000);
        out.push({ t, lat: a.lat, lon: a.lon, acc: a.acc, spd: 0, syn: true });
      }
    }
    out.push(b);
  }
  return out;
}

// İki ardışık nokta arasındaki parça türü:
//  'move'    normal kayıt (ya da yerinde sessizlik)
//  'est'     kısa kayıt boşluğu — iki uç doğruyla birleştirilir, haritada kesikli çizilir
//  'blind'   GPS yokken araçla gidilmiş (tünel/metro adayı)
//  'unknown' veri yok (telefon kapalı / uygulama kapatılmış) — tahmin yürütülmez
function segKind(a, b) {
  const dt = b.t - a.t;
  if (dt < CFG.EST_MIN_DT) return 'move';
  const d = hav(a, b);
  if (d <= moveMin(a, b)) return 'move';
  const v = d / (dt / 1000);
  if (dt >= CFG.MIN_STAY && d > CFG.R_GAP_STAY) {
    return v >= CFG.BLIND_MIN_V && dt <= CFG.BLIND_MAX_DT ? 'blind' : 'unknown';
  }
  if (dt >= CFG.BLIND_MIN_DT && d >= CFG.BLIND_MIN_D && v >= CFG.BLIND_MIN_V) return 'blind';
  return 'est';
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
      // kaba konumlu nokta daha geniş yarıçapla "yakın" sayılır (oynaması durağı bölmesin)
      const near = hav(c, p[j]) <= Math.max(CFG.R_STAY, 30 + (p[j].acc || 0)) || (dt >= CFG.MIN_STAY && hav(p[j - 1], p[j]) <= moveMin(p[j - 1], p[j]));
      if (!near) break;
      sLat += p[j].lat; sLon += p[j].lon; cnt++; j++;
    }
    if (p[j - 1].t - p[i].t >= CFG.MIN_STAY) {
      stays.push(refineStay(p, i, j - 1));
      i = j; // son durak noktası sonraki yolculuğun ilk noktası olur (segment)
    } else i++;
  }
  return stays;
}

// Durağı inceltir. Küme 60 m yarıçaplıdır; yani içine, durağa YÜRÜRKEN ve ayrılırken geçilen son/ilk
// ~60 m de girer. Bunlar durak değil yolculuktur (kısa yürüyüşlerin mesafesi 100 m eksik çıkmasın).
//  - Merkez: zaman-ağırlıklı ortalama (nerede VAKİT geçirildiyse orası; gelirken atılan noktalar değil).
//  - Baştaki ve sondaki, merkezden R_CORE'dan uzak noktalar (en çok TRIM_MS'lik) komşu yolculuğa bırakılır.
function refineStay(p, a, b) {
  let sLat = 0, sLon = 0, w = 0;
  for (let k = a; k < b; k++) { const dt = p[k + 1].t - p[k].t; sLat += p[k].lat * dt; sLon += p[k].lon * dt; w += dt; }
  const c = { lat: sLat / w, lon: sLon / w };
  let a2 = a, b2 = b;
  // (bir sonraki nokta zaman penceresinin dışındaysa oraya geçilmez: durak erken bitmesin/geç başlamasın)
  // Kaba konumlu nokta (±65 m) merkezden uzak görünse de "çekirdek dışı" sayılmaz: uzaklığı doğruluğundan küçük.
  const out = (q) => hav(c, q) > Math.max(CFG.R_CORE, q.acc || 0);
  while (a2 < b2 && out(p[a2]) && p[a2 + 1].t - p[a].t <= CFG.TRIM_MS) a2++;
  while (b2 > a2 && out(p[b2]) && p[b].t - p[b2 - 1].t <= CFG.TRIM_MS) b2--;
  if (b2 <= a2) { a2 = a; b2 = b; } // çekirdek bulunamadı: dokunma
  return { a: a2, b: b2, lat: c.lat, lon: c.lon };
}

// Hareket kayıtlarından t anındaki durumu bul (ikili arama). Düşük güvenli ya da eski kayıt = bilinmiyor.
function makeActAt(acts) {
  if (!acts || !acts.length) return () => null;
  return (t) => {
    let lo = 0, hi = acts.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (acts[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best < 0) return null;
    const a = acts[best];
    if (t - a.t > CFG.ACT_VALID || a.c < 1 || a.k === 'U') return null;
    return a.k;
  };
}

// ---- 3) Yolculuk: izi düzelt, hız/hareket parçalarına böl, her parçaya ulaşım türü ver ----
function makeTrip(p, a, b, actAt) {
  const n = b - a + 1;
  const kinds = [];
  for (let k = a; k < b; k++) kinds.push(segKind(p[k], p[k + 1]));

  // İzi düzelt: kesintisiz kayıt parçalarını ayrı ayrı yumuşat (boşlukların üstünden yumuşatma yapılmaz).
  const sp = new Array(n);
  for (let k = 0, cs = 0; k < n; k++) {
    if (k === n - 1 || kinds[k] !== 'move') {
      const sm = smoothTrack(p.slice(a + cs, a + k + 1));
      for (let i = 0; i < sm.length; i++) sp[cs + i] = sm[i];
      cs = k + 1;
    }
  }

  // Beklemeler: yerinde durulan süre boyunca noktalar tek yere (ortanca) sabitlenir — dururken GPS'in
  // gezinmesi çizgide "gidip gelme", mesafede de sahte yol olarak görünmesin. Ham noktalar (raw) aynen kalır.
  const waits = findWaits(p, a, b);
  for (const w of waits) for (let k = w.i0; k <= w.i1; k++) sp[k - a] = { ...sp[k - a], lat: w.lat, lon: w.lon, v: 0 };

  // Parçalar: mesafe düzeltilmiş izden. Hız: sık noktalarda düzeltilmiş (Kalman) hız; iki nokta arası
  // uzunsa (duruş: hareketsizken nokta gelmez) ya da kayıt boşluğuysa uçtan uca ortalama.
  const segs = [];
  for (let k = 0; k < n - 1; k++) {
    const d = hav(sp[k], sp[k + 1]), dt = sp[k + 1].t - sp[k].t, kind = kinds[k];
    const ws = kind === 'move' && dt <= 5000 ? (sp[k].v + sp[k + 1].v) / 2 : d / (dt / 1000);
    segs.push({ d, dt, kind, ws, act: actAt((sp[k].t + sp[k + 1].t) / 2) });
  }
  const dist = segs.reduce((s, x) => s + x.d, 0);
  // Yolculuk sayılması için: en az MIN_TRIP_DIST ve noktaların doğruluğuna göre anlamlı bir mesafe
  // (kaba konumda 80 m'lik "hareket" ölçüm oynamasından ayırt edilemez).
  if (dist < Math.max(CFG.MIN_TRIP_DIST, 1.5 * quantile(sp.map((q) => q.acc || 0), 0.5))) return null;

  // Sınıf: B=kör, S=yaya, K=bisiklet, F=hızlı/araç. Hareket işlemcisi ne diyorsa o; demiyorsa hıza bak.
  const cls = (s) => {
    if (s.kind === 'blind') return 'B';
    if (s.act === 'A') return 'F';
    if (s.act === 'C') return 'K';
    if ((s.act === 'W' || s.act === 'R') && s.ws <= CFG.WALK_ACT_MAX_V) return 'S';
    return s.ws < CFG.WALK_V ? 'S' : 'F';
  };
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
  // Koşuları sadeleştir. (Eski kural "kısa koşuyu uzun komşusuna kat" idi; durak durak giden otobüsün
  // 45 sn'lik her hamlesi, öncesindeki uzun bekleyişe katılıp koca yolculuk "yaya" çıkıyordu.)
  const veh = (r) => r && (r.c === 'F' || r.c === 'K');
  const p90 = (r) => { const ws = []; for (let k = r.a; k <= r.b; k++) ws.push(segs[k].ws); return quantile(ws, 0.9); };
  // Gerçek yürüyüş mü (araçtan inip yürümek)? 1) Hareket algılayıcısı emin biçimde "yürüyor/koşuyor" diyorsa
  // evet, "araçta" diyorsa hayır. 2) Algılayıcı emin değilse (cepte, otobüste çoğu zaman öyle — 30 Eyl kaydı)
  // yalnız KALİTELİ GPS'e güvenilir: en az 1 dk, sık (≤ 6 sn arayla) ve doğru (≤ 20 m) noktalar, çoğunda
  // ölçülmüş hız yürüme bandında ve aralıkta hiç araç hızı yok. Otobüste GPS seyrek ve kabadır; trafikte
  // sürünmesi hız olarak yürüyüşe benzer ama bu kalite şartını geçemez.
  const walked = (r) => {
    let w = 0, au = 0;
    for (let k = r.a; k <= r.b; k++) { const x = segs[k]; if (x.act === 'W' || x.act === 'R') w += x.dt; else if (x.act === 'A') au += x.dt; }
    if (w >= r.dt * 0.3 && w > au) return true;
    if (au >= r.dt * 0.3 || r.dt < CFG.WALK_MIN_DT) return false;
    // yalnız iç noktalar: uçlar komşu (araç) koşusuyla ortaktır, araç hızını taşır
    const q = p.slice(a + r.a + 1, a + r.b + 1).filter((x) => !x.syn), gaps = [];
    if (q.length < 5) return false;
    for (let i = 1; i < q.length; i++) gaps.push(q[i].t - q[i - 1].t);
    const sp = q.filter((x) => x.spd != null && (x.acc == null || x.acc <= 25)).map((x) => x.spd);
    if (quantile(q.map((x) => (x.acc == null ? 99 : x.acc)), 0.5) > CFG.WALK_ACC || quantile(gaps, 0.5) > CFG.WALK_GAP || sp.length < q.length * 0.5) return false;
    const med = quantile(sp, 0.5);
    return med >= CFG.WALK_MIN_V && med < CFG.WALK_V && sp.filter((v) => v >= CFG.WALK_MAX_V).length < 2; // tek sıçrama affedilir
  };
  // 1) iki hızlı koşu arasındaki kısa ve yerinde yavaşlık = duruş (ışık, durak, sıkışık trafik) → araç.
  //    Böylece dur-kalk giden aracın kısa hamleleri tek bir uzun araç koşusunda birleşir.
  runs.forEach((r, i) => {
    const L = runs[i - 1], R = runs[i + 1];
    if (r.c === 'S' && veh(L) && veh(R) && !walked(r) && r.dt < CFG.WAIT_MAX && (r.d < CFG.STOP_D || r.d / (r.dt / 1000) < 0.55)) r.c = L.d >= R.d ? L.c : R.c;
  });
  coalesce('c');
  // 2) sağlam olmayan hızlı koşular (GPS sıçraması, koşarak karşıya geçme) yayadır. Sağlam = ya uzun
  //    sürmüş ve gerçekten hızlı (ortalaması ya da tepe hızı yürüyüşün üstünde), ya da insanın
  //    yürüyerek gidemeyeceği hızla en az SOLID_D metre.
  const solid = (r) => {
    const avg = r.d / (r.dt / 1000);
    return (r.dt >= CFG.SHORT_RUN && (avg >= CFG.WALK_V || p90(r) >= CFG.SOLID_P90)) || (r.d >= CFG.SOLID_D && avg >= CFG.SOLID_V);
  };
  runs.forEach((r) => { if (veh(r) && !solid(r)) r.c = 'S'; });
  coalesce('c');
  // 3) yolculuğun başındaki/sonundaki birkaç adımlık yavaşlık (kapıdan araca) → araç
  [[0, 1], [runs.length - 1, runs.length - 2]].forEach(([i, j]) => {
    const r = runs[i], nb = runs[j];
    if (r && r.c === 'S' && veh(nb) && r.dt < CFG.SHORT_RUN && r.d < CFG.DOOR_D && !(r.dt >= CFG.WALK_MIN_DT && walked(r))) r.c = nb.c;
  });
  coalesce('c');

  // Yolculukta telefonun hareket bilgisi (güvenli okuma) hiç var mı? Yoksa izin verilmemiştir.
  const hasAct = segs.some((x) => x.act);
  // Koşu -> tür
  for (const r of runs) {
    r.avg = r.d / (r.dt / 1000);
    if (r.c === 'S') r.mode = 'walk';
    else if (r.c === 'K') r.mode = 'bike';
    else if (r.c === 'B') r.mode = r.d >= CFG.METRO_MIN_D ? 'metro' : 'car';
    else {
      // Hareket işlemcisi "araçta" dediyse araç; hiç bilgi yoksa hızdan bisiklet/araç ayrımı.
      let auto = 0, known = 0, stopped = 0; const ws = [];
      for (let k = r.a; k <= r.b; k++) {
        const sg = segs[k]; ws.push(sg.ws);
        if (sg.ws < CFG.STOP_V) stopped += sg.dt;
        if (sg.act) { known += sg.dt; if (sg.act === 'A') auto += sg.dt; }
      }
      // Hızdan "bisiklet" tahmini YALNIZ telefon hareket bilgisi hiç vermiyorsa (izin yok) yapılır. Hareket bilgisi
      // varsa bisiklet kararı algılayıcının "bisiklet" demesine bırakılır (o zaman koşu zaten K sınıfıdır):
      // tıxacda 10-15 km/s giden, duruşları seyrek görünen otobüs hız olarak bisiklete benzer (30 Eyl, Analiz).
      // Hızı bisiklet gibi ama sık sık uzun duruyorsa (dur-kalk trafik) zaten arabadır.
      const bikeLike = !hasAct && quantile(ws, 0.9) < CFG.BIKE_P90 && r.avg < CFG.BIKE_AVG && stopped < r.dt * CFG.BIKE_STOP_FRAC;
      r.mode = known > r.dt * 0.3 && auto >= known * 0.5 ? 'car' : bikeLike ? 'bike' : 'car';
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
  // Ama gerçek yürüyüşse (araçtan inip 1-2 dk yürüyüp başka araca binmek) ayrı yaya parçası kalır.
  runs.forEach((r, i) => {
    const L = runs[i - 1], R = runs[i + 1];
    if (r.mode !== 'walk' || !L || !R || L.mode === 'walk' || R.mode === 'walk' || walked(r)) return;
    if (r.dt < CFG.WAIT_MAX || r.avg < 0.55) r.mode = L.d >= R.d ? L.mode : R.mode;
  });
  coalesce('mode');

  // Duruşun yeri: yavaş kesimlerin (k0..k1) noktalarının ortancası
  const stopAt = (k0, k1, dur) => {
    const q = sp.slice(k0, k1 + 2), mean = (f) => q.reduce((x, y) => x + f(y), 0) / q.length;
    if (q.length <= 3) return { lat: mean((x) => x.lat), lon: mean((x) => x.lon), dur }; // az noktada ortalama
    return { lat: quantile(q.map((x) => x.lat), 0.5), lon: quantile(q.map((x) => x.lon), 0.5), dur };
  };
  const legs = runs.map((r) => {
    // Araç parçasındaki duruşlar (ışık, durak). İki biçimde görünür:
    //  (a) sık noktalarda hız STOP_V altına iner ve en az STOP_MIN sürer,
    //  (b) dururken nokta gelmez (yer değiştirme yok): tek bir uzun parça, ortalaması STOP_AVG altında.
    // Sondaki yavaşlık (yürüyüşün sonunda durakta bekleme) ayrıca ölçülür: tailWait.
    let stops = 0, stopMs = 0, run = 0, runK = 0, est = 0, tailWait = 0, slowMs = 0; const ws = [], stopPts = [];
    for (let k = r.a; k <= r.b; k++) {
      const s = segs[k];
      if (s.kind !== 'move') est += s.d; else ws.push(s.ws);
      if (s.kind === 'move' && s.ws < CFG.JAM_V) slowMs += s.dt; // tıxac / yavaş akış (duruşlar dahil)
      const slow = s.kind === 'move' && (s.ws < CFG.STOP_V || (s.dt >= CFG.STOP_MIN && s.d / (s.dt / 1000) < CFG.STOP_AVG));
      if (slow) { if (!run) runK = k; run += s.dt; }
      else { if (run >= CFG.STOP_MIN) { stops++; stopMs += run; stopPts.push(stopAt(runK, k - 1, run)); } run = 0; }
    }
    if (run >= CFG.STOP_MIN) { stops++; stopMs += run; stopPts.push(stopAt(runK, r.b, run)); }
    for (let k = r.b; k >= r.a; k--) { const s = segs[k]; if (s.kind === 'move' && s.d / (s.dt / 1000) < 0.4) tailWait += s.dt; else break; }
    return {
      mode: r.mode, a: r.a, b: r.b + 1, // a..b: yolculuk içi nokta indeksleri (b dahil)
      t0: sp[r.a].t, t1: sp[r.b + 1].t, dist: r.d, dur: r.dt, avg: r.d / (r.dt / 1000),
      max: Math.max(quantile(ws, 0.95), r.d / (r.dt / 1000)), stops, stopMs,
      est: est > r.d * 0.5, // parçanın çoğu kayıt boşluğu/GPS'siz mi (tahmini)
      tailWait,             // sonunda yerinde bekleme (ms) — yürüyüşün sonunda durakta bekleme ipucu
      slowMs,               // araçta JAM_V altında geçen süre (ms): tıxac, ışık, durak
      stopPts,              // duruşların yeri ve süresi [{lat, lon, dur}] — otobüs durağına denk geliyor mu?
      waits: [],            // bu parçadaki beklemeler (aşağıda doldurulur)
      gps: gpsQ(p.slice(a + r.a, a + r.b + 2)), // GPS kalitesi: iyi / orta / zayıf (çizgi ne kadar güvenilir)
    };
  });
  // Her bekleme, orta anı hangi parçaya düşüyorsa ona aittir
  for (const w of waits) { const m = (w.t0 + w.t1) / 2; (legs.find((l) => m >= l.t0 && m <= l.t1) || legs[legs.length - 1]).waits.push(w); }
  const dur = sp[n - 1].t - sp[0].t;
  const trip = {
    type: 'trip', t0: sp[0].t, t1: sp[n - 1].t, dist, dur, legs,
    avg: dist / (dur / 1000), max: Math.max(...legs.map((l) => l.max)),
    pts: sp,                                  // düzeltilmiş iz (her noktada v = hız)
    raw: p.slice(a, b + 1),                   // ham noktalar (pts ile aynı sıra) — yola oturtmaya bunlar gider
    waits,                                    // yerinde beklemeler [{t0, t1, lat, lon}]
    dash: segs.map((s) => s.kind !== 'move'), // parça parça: tahmini/GPS'siz mi (kesikli çizilir)
  };
  setTripMode(trip);
  return trip;
}

// Beklemeler: yolculuk içinde yerinde durulan anlar (ışıkta, durakta, yaya olarak beklerken). İki biçimde:
//  (a) sıkı öbek: bir noktadan başlayıp WAIT_R içinde en az WAIT_MIN kalınır. Hareketsizken telefon yeni nokta
//      yazmadığı için çoğu zaman "uzun aralıklı ama yerinde" iki nokta olarak görünür. Kaba konumda
//      (otobüs içi ±50 m) yarıçap doğrulukla büyür.
//  (b) yerinde sayma: telefon dururken GPS hız ölçemez ve konum 30-70 m gezinir (30 Eyl, durakta 4 dk:
//      noktalar köşenin kuzeyinde gezindi, telefon ±16-33 m diyordu; çizgi "yukarı gidip geri geldi" gibi
//      çiziliyordu). Kural: hızı ölçülmemiş (ya da < 0,8 m/s) en az 3 ardışık nokta, en az 1 dk ve ilk üçte
//      birlik ile son üçte birlik arasında ilerleme < 0,25 m/s (yürüyen biri hızı ölçülmese de ilerler).
//      Uçlardaki varış/kalkış noktaları (öncekinden/sonrakinden > 2,5 m/s ile gelen) beklemeye katılmaz.
// Çakışanlar birleştirilir; merkez noktaların ORTANCASI (tek sıçrayan nokta merkezi kaydırmasın).
// Dönüş: [{t0, t1, lat, lon, i0, i1}] (i0..i1: p içindeki nokta aralığı)
function findWaits(p, a, b) {
  const win = [];
  for (let i = a; i < b;) {
    let j = i;
    while (j + 1 <= b && !p[j + 1].syn && hav(p[i], p[j + 1]) <= Math.max(CFG.WAIT_R, 0.8 * Math.min(p[i].acc || 0, p[j + 1].acc || 0))) j++;
    if (j > i && !p[i].syn && p[j].t - p[i].t >= CFG.WAIT_MIN) { win.push([i, j]); i = j; } else i++;
  }
  const still = (q) => !q.syn && (q.spd == null || q.spd < 0.8);
  const vImp = (x, y) => hav(p[x], p[y]) / Math.max(1, (p[y].t - p[x].t) / 1000);
  const med = (arr) => quantile(arr, 0.5);
  for (let i = a; i <= b;) {
    if (!still(p[i])) { i++; continue; }
    let j = i;
    while (j + 1 <= b && still(p[j + 1])) j++;
    let s0 = i, e0 = j;
    while (s0 < e0 && ((s0 > a && vImp(s0 - 1, s0) > 2.5) || vImp(s0, s0 + 1) > 2.5)) s0++;
    while (e0 > s0 && vImp(e0 - 1, e0) > 2.5) e0--;
    const n = e0 - s0 + 1, k = Math.floor(n / 3);
    if (n >= 3 && p[e0].t - p[s0].t >= CFG.WALK_MIN_DT && p[e0].t - p[s0].t <= CFG.WAIT_B_MAX) {
      const A = p.slice(s0, s0 + k), C = p.slice(e0 - k + 1, e0 + 1), Q = p.slice(s0, e0 + 1);
      const ca = { lat: med(A.map((q) => q.lat)), lon: med(A.map((q) => q.lon)) }, cc = { lat: med(C.map((q) => q.lat)), lon: med(C.map((q) => q.lon)) };
      const dt = (C.reduce((x, q) => x + q.t, 0) / k - A.reduce((x, q) => x + q.t, 0) / k) / 1000;
      // yayılma: bütün noktalar merkeze yakın kalmalı — gidip aynı yoldan dönen (hızsız) yürüyüşte baş ve son
      // aynı yerdedir ama aradaki noktalar yüzlerce metre uzaktadır; o bekleme değil yolculuktur.
      const cm = { lat: med(Q.map((q) => q.lat)), lon: med(Q.map((q) => q.lon)) }, lim = Math.max(80, 2.5 * med(Q.map((q) => q.acc || 0)));
      if (hav(ca, cc) / Math.max(1, dt) < 0.25 && Q.every((q) => hav(cm, q) <= lim)) win.push([s0, e0]);
    }
    i = j + 1;
  }
  win.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const w of win) { const m = merged[merged.length - 1]; if (m && w[0] <= m[1]) m[1] = Math.max(m[1], w[1]); else merged.push([...w]); }
  return merged.map(([i0, i1]) => {
    const q = p.slice(i0, i1 + 1).filter((x) => !x.syn);
    return { t0: p[i0].t, t1: p[i1].t, lat: med(q.map((x) => x.lat)), lon: med(q.map((x) => x.lon)), i0, i1 };
  });
}

// Kullanıcının tür düzeltmesi (it.override). Çok parçalı yolculukta parçalar korunur:
//  • düzeltme otomatik türle aynıysa hiçbir şey değişmez (eski sürümde "Otobüs" seçilmiş yolculuk yürüyüş
//    parçalarını da otobüs rengine boyuyor, indi/bindi noktalarını gizliyordu — 1 Eki şikâyeti),
//  • hem yürüyüş hem araç parçası varsa araç türü düzeltmesi (otobüs/araba/metro) yalnız araç parçalarını
//    değiştirir, yürüyüşler kalır,
//  • yaya/bisiklet düzeltmesi ya da tek türlü yolculuk: bütün yolculuk tek tür sayılır (overridden).
function applyOverride(it, ov) {
  it.override = ov; it.autoMode = it.mode;
  if (ov === it.mode) return;
  const mixed = it.legs.some((l) => l.mode === 'walk') && it.legs.some((l) => l.mode !== 'walk');
  if (mixed && ov !== 'walk' && ov !== 'bike') {
    for (const l of it.legs) if (l.mode !== 'walk') {
      l.autoMode = l.mode; l.mode = ov; // autoMode: yola oturtma anahtarı bununla
      // metro yer altında gider: araba yol ağına oturmuş çizgi ve yol mesafesi anlamsız → ham ize dön
      if (ov === 'metro' && l.snap) { l.snap = null; l.dist = l.rawDist != null ? l.rawDist : l.dist; l.avg = l.dist / (l.dur / 1000); }
    }
    it.dist = it.legs.reduce((s, l) => s + l.dist, 0); it.avg = it.dist / (it.dur / 1000);
    setTripMode(it);
    return;
  }
  it.mode = ov; it.overridden = true;
}

// Parçanın GPS kalitesi: ortanca doğruluk (m), hızı ölçülmemiş nokta oranı, noktalar arası ortanca süre (sn).
//  'iyi'   ≤ 12 m ve sık (≤ 6 sn) — çizgi gerçek yolu gösterir
//  'zayıf' > 25 m ya da noktaların çoğu hızsız (GPS değil Wi-Fi/baz konumu; ör. otobüsten inince) — çizgi yaklaşık
//  'orta'  arası
function gpsQ(pts) {
  const q = pts.filter((x) => !x.syn);
  if (q.length < 2) return null;
  const acc = quantile(q.map((x) => (x.acc == null ? 99 : x.acc)), 0.5), nos = q.filter((x) => x.spd == null).length / q.length, gaps = [];
  for (let i = 1; i < q.length; i++) gaps.push((q[i].t - q[i - 1].t) / 1000);
  const gap = quantile(gaps, 0.5);
  return { acc: Math.round(acc), nos, gap, lvl: acc > 25 || nos > 0.6 ? 'zayıf' : acc <= 12 && gap <= 6 ? 'iyi' : 'orta' };
}

// Yolculuğun ana türü: en çok mesafe kat edilen parça türü.
function setTripMode(trip) {
  const byMode = {};
  trip.legs.forEach((l) => { byMode[l.mode] = (byMode[l.mode] || 0) + l.dist; });
  trip.mode = Object.keys(byMode).sort((x, y) => byMode[y] - byMode[x])[0];
}

// ---- 4) Zaman çizelgesi: durak / yolculuk / veri-yok sırası ----
export function segment(points, acts, busNear) {
  const p = points, items = [], actAt = makeActAt(acts);
  if (p.length < 2) return items;
  const pushTrips = (a, b) => {
    let start = a;
    for (let k = a; k < b; k++) {
      if (segKind(p[k], p[k + 1]) !== 'unknown') continue;
      if (k > start) { const t = makeTrip(p, start, k, actAt); if (t) items.push(t); }
      items.push({ type: 'gap', t0: p[k].t, t1: p[k + 1].t });
      start = k + 1;
    }
    if (b > start) { const t = makeTrip(p, start, b, actAt); if (t) items.push(t); }
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
  dropPhantoms(items, actAt);
  refineBus(items, busNear);
  return items;
}

// Hayalet yolculuk: telefon masada dururken konum birkaç dakikalığına yüzlerce metre öteye kayıp geri
// gelir (bina içinde Wi-Fi/baz konumu). Böyle "gidip aynı yere dönen" kısa yolculuk, gerçek harekete dair
// HİÇ kanıt yoksa silinir ve iki yanındaki durak birleştirilir. Kanıt: hareket algılayıcısının
// "yürüyor/araçta/bisiklet/koşu" demesi ya da GPS'in iyi doğrulukla (≤ 25 m) en az 3 noktada gerçek hız ölçmesi.
function dropPhantoms(items, actAt) {
  const moved = (trip) => {
    for (let t = trip.t0; t <= trip.t1; t += 10e3) { const k = actAt(t); if (k && k !== 'S') return true; }
    let good = 0, fair = 0;
    for (const q of trip.pts) if (q.spd != null && q.spd > 1.0) { if (q.acc == null || q.acc <= 25) good++; else if (q.acc <= 50) fair++; }
    return good >= 3 || fair >= 6; // kaba noktada da ölçülmüş hız çoksa gerçek harekettir
  };
  for (let i = 1; i < items.length - 1; i++) {
    const a = items[i - 1], t = items[i], b = items[i + 1];
    if (t.type !== 'trip' || a.type !== 'stay' || b.type !== 'stay') continue;
    // kısa (≤ 15 dk) ise her zaman; daha uzunsa yalnız noktaları kabaysa (Wi-Fi/baz konumu: ortanca ±30 m üstü)
    // kaba yolculuk da ancak kısa (≤ 30 dk) ve küçükse (≤ 1 km) hayalet olabilir — 40 dk / 5 km'lik gerçek bir
    // gidiş-dönüş, GPS kaba diye silinmez
    const coarse = quantile(t.pts.map((q) => (q.acc == null ? 99 : q.acc)), 0.5) > 30 && t.dur <= 2 * CFG.PHANTOM_MAX && t.dist <= CFG.PHANTOM_D;
    if ((t.dur > CFG.PHANTOM_MAX && !coarse) || hav(a, b) > CFG.R_PLACE || moved(t)) continue;
    // sil: a ile b tek durak olur
    const w1 = a.t1 - a.t0, w2 = b.t1 - b.t0;
    a.lat = (a.lat * w1 + b.lat * w2) / (w1 + w2 || 1); a.lon = (a.lon * w1 + b.lon * w2) / (w1 + w2 || 1);
    a.t1 = b.t1;
    items.splice(i, 2);
    i--;
  }
}

// Araba mı otobüs mü? Telefonun hareket algılayıcısı ikisine de "araçta" der; hız da benzer. Ayırt eden
// davranıştır — gerçek kayıtla (30 Eyl, iş → otobüs → yürü → otobüs → ev) ayarlandı:
//  • durakta bekleme: araçtan hemen önce kısa bir durak (≤ 20 dk) ya da yürüyüşün sonunda ≥ 90 sn bekleme,
//    öncesinde durağa yürüyüş → en güçlü ipucu (kendi arabana binmeden önce yol kenarında beklemezsin)
//  • durak durak gitme: km başına duruş
//  • araçtan önce / sonra yürüyüş (durağa gitme / duraktan yürüme)
// busNear(lat, lon): en yakın OSM otobüs durağına uzaklık (m) — varsa en güçlü ipucu: otobüs DURAKTA durur,
// araba ışıkta/tıxacda rastgele yerde. Duruşların çoğu (≥ %50, en az 3) gerçek durağın 30 m yakınındaysa otobüstür.
function refineBus(items, busNear) {
  // i. öğeden dir yönündeki komşu yolculuğun uç yürüyüşü (m); arada kısa durak varsa onu da bildir
  const near = (i, dir) => {
    let j = i + dir, wait = false;
    if (items[j] && items[j].type === 'stay' && items[j].t1 - items[j].t0 <= CFG.BUS_WAIT_MAX) { j += dir; wait = true; }
    const t = items[j];
    if (!t || t.type !== 'trip') return { walk: 0, wait: false };
    const leg = dir < 0 ? t.legs[t.legs.length - 1] : t.legs[0];
    return { walk: leg.mode === 'walk' ? leg.dist : 0, wait };
  };
  items.forEach((trip, i) => {
    if (trip.type !== 'trip') return;
    trip.legs.forEach((leg, li) => {
      if (leg.mode !== 'car' || leg.est || leg.dist < CFG.BUS_MIN_D || leg.max > CFG.BUS_MAX_V) return;
      const prev = trip.legs[li - 1], next = trip.legs[li + 1];
      const nb = prev ? null : near(i, -1), na = next ? null : near(i, 1);
      const before = prev ? (prev.mode === 'walk' ? prev.dist : 0) : nb.walk;
      const after = next ? (next.mode === 'walk' ? next.dist : 0) : na.walk;
      const waited = prev ? prev.mode === 'walk' && prev.tailWait >= CFG.BUS_TAIL_WAIT : nb.wait;
      const rate = leg.stops / (leg.dist / 1000);
      const W = CFG.BUS_WALK_D;
      // Duruşların kaçı gerçek otobüs durağında (OSM)
      const uniq = [];
      for (const q of leg.stopPts) if (!uniq.some((x) => hav(x, q) < 60)) uniq.push(q);
      leg.atStops = busNear ? uniq.filter((q) => busNear(q.lat, q.lon) <= CFG.BUS_STOP_R).length : null;
      const atBus = leg.atStops != null && leg.atStops >= CFG.BUS_STOP_N && leg.atStops >= uniq.length * CFG.BUS_STOP_FRAC && leg.atStops / (leg.dist / 1000) >= CFG.BUS_STOP_KM;
      // "Durakta bekledi + yürüdü" ipucu artık durak durak gitmeyle birlikte aranır (km başına ≥ BUS_WAIT_RATE
      // duruş): arabaya binmeden önce de 2-3 dk beklenir (1 Eki: 6,7 km'de 2 duruşlu araba "otobüs" sanıldı).
      const busy = rate >= CFG.BUS_WAIT_RATE;
      if (atBus || (waited && before >= W && busy) || (rate >= CFG.BUS_STOPS_KM && (before >= W || after >= W)) || (rate >= CFG.BUS_STOPS_KM2 && before >= W && after >= W)) leg.mode = 'bus';
    });
    setTripMode(trip);
    // Otobüs/metro ile başlayan yolculuğun hemen öncesindeki kısa durak = durakta/istasyonda bekleme.
    const first = trip.legs[0], prev = items[i - 1];
    if (prev && prev.type === 'stay' && (first.mode === 'bus' || first.mode === 'metro') && prev.t1 - prev.t0 <= CFG.BUS_WAIT_MAX) prev.wait = true;
  });
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
    if (!st.wait) pl.real = true; // en az bir gerçek (bekleme olmayan) durak
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
    pl.waitOnly = !pl.real && !pl.saved; // yalnız otobüs/metro beklemesi görülen yer: durak
    if (!pl.name) pl.name = pl.kind === 'home' ? 'Ev' : pl.kind === 'work' ? 'İş' : pl.addr || (pl.waitOnly ? 'Durak ' : 'Konum ') + k++;
  }
  return used;
}

// ---- 6) Rutinler: önemli yerler arası A→B; çıkış ve varış saat aralıkları ----
function buildRoutines(items, places) {
  // Önemli yerler: ev, iş, sık gidilen yerler — otobüs durağı (yalnız bekleme) rutinin ucu olmaz, ara durak sayılır
  const sig = new Set(places.filter((pl) => !pl.waitOnly && (pl.kind === 'home' || pl.kind === 'work' || (pl.visits >= 2 && pl.total >= 30 * 60e3))).slice(0, 8));
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
//        detect: ev/iş otomatik bulunsun mu, hints: {home:{lat,lon}, work:{lat,lon}},
//        acts: hareket kayıtları (zaman sıralı),
//        snapOf: (leg) => {parts} | null — yola oturtma sonucu (sunucudan, telefonda saklı),
//        busNear: (lat, lon) => m — en yakın otobüs durağına uzaklık (OSM, telefonda saklı) }
export function analyze(rawPoints, opt) {
  const { from, to, saved = [], overrides = {}, now, detect = false, hints, acts = [], snapOf, busNear } = opt;
  const raw = clean(rawPoints);
  // Ham iz (isteğe bağlı harita katmanı): aralıktaki tüm kayıtlı noktalar, hiç düzeltilmeden.
  const track = [];
  let curLine = null, prevPt = null;
  for (const q of raw) {
    if (q.t < from || q.t >= to) continue;
    if (!curLine || segKind(prevPt, q) !== 'move') { curLine = []; track.push(curLine); }
    curLine.push(q); prevPt = q;
  }
  const nPoints = raw.filter((q) => q.t >= from && q.t < to).length;
  const lastT = raw.length ? raw[raw.length - 1].t : null;
  const lastPt = raw.length ? { ...raw[raw.length - 1] } : null; // canlı konum gelmezse haritadaki nokta için
  const p = inferDepartures(raw);
  // Kayıt açık ve son nokta eskiyse: hâlâ orada duruyoruz (hareketsizken nokta gelmez).
  if (now && p.length && now - p[p.length - 1].t >= CFG.MIN_STAY) p.push({ ...p[p.length - 1], t: now });
  const all = segment(p, acts, busNear);

  // Yola oturtulmuş parçalar: çizgi yol ağını izler, mesafe yol üzerindeki gerçek uzunluktur.
  // Tür ayrımı bundan ÖNCE yapıldı (eşikler ham izle çalışır) — sonuç gelince tür değişmez, anahtar kaymaz.
  if (snapOf) for (const it of all) {
    if (it.type !== 'trip') continue;
    let hit = false;
    for (const l of it.legs) {
      const r = snapOf(l);
      if (!r) continue;
      // Sunucunun yol çizgisi gerçek izle birleştirilir: çizgi izden hiçbir yerde birkaç metreden fazla sapmaz.
      l.snap = fuseSnap(it.pts.slice(l.a, l.b + 1), r.parts, l.mode);
      l.rawDist = l.dist; l.dist = l.snap.d; l.avg = l.dist / (l.dur / 1000); l.max = Math.max(l.max, l.avg); hit = true;
    }
    if (hit) { it.dist = it.legs.reduce((s, l) => s + l.dist, 0); it.avg = it.dist / (it.dur / 1000); it.max = Math.max(...it.legs.map((l) => l.max)); }
  }

  const ovKeys = Object.keys(overrides).map(Number);
  all.forEach((it, i) => {
    if (it.type !== 'trip') return;
    // Komşu duraklar: listelerde "nereden → nereye" ve haritada çizginin bağlanacağı uçlar.
    it.fromStay = all[i - 1] && all[i - 1].type === 'stay' ? all[i - 1] : null;
    it.toStay = all[i + 1] && all[i + 1].type === 'stay' ? all[i + 1] : null;
    const k = ovKeys.find((t) => Math.abs(t - it.t0) <= 120e3);
    if (k !== undefined) applyOverride(it, overrides[k]);
  });
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
