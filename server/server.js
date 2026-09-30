'use strict';
// İZ yol eşleştirme servisi (map matching).
// Telefon, bitmiş bir yolculuk parçasının GPS noktalarını gönderir; servis noktaları OSRM ile gerçek yol
// ağına oturtur, yolu izleyen çizgiyi ve yol üzerindeki gerçek uzunluğu döndürür.
//   POST /v1/match   başlık x-iz-key
//                    gövde {legs:[{id, m:'walk'|'bike'|'car'|'bus', p:[[lat, lon, t(sn), acc(m)], ...]}]}
//                    cevap {v, legs:[{id, ok, d, parts:[{g:0|1, c:[[lat, lon], ...]}]} | {id, ok:false, why}]}
//                    g=1: iki eşleşme arasındaki boşluk (telefonda kesikli çizilir)
//   GET  /v1/health  motorlar ayakta mı
//   GET  /v1/busstops  (x-iz-key) OSM otobüs durakları {v, n, pts:[[lat, lon], ...]} — otobüs/araba ayrımı için
// Gizlilik: hiçbir istek diske/veritabanına yazılmaz, konum loglanmaz (nginx'te de access_log kapalı).
// Bağımlılık yok (Node 20: fetch + http).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// .env (KEY=VALUE satırları). Dosyadaki değer her zaman geçerli — pm2'nin sakladığı eski ortam ezilsin.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
} catch (e) { /* .env yok: yalnız ortam değişkenleri */ }

const PORT = Number(process.env.PORT) || 3700;
const KEY = process.env.IZ_KEY || '';
const OSRM = { foot: process.env.OSRM_FOOT || 'http://127.0.0.1:3701', car: process.env.OSRM_CAR || 'http://127.0.0.1:3702' };
const V = 1; // kural sürümü — eşleştirme mantığı değişince artır

// Tür → yol ağı ve ayarlar.
//   gap:  bundan yakın ardışık noktalar seyreltilir (m) — çok sık nokta eşleştirmeyi iyileştirmez, yavaşlatır
//   rMin/rMax: noktanın "hata yarıçapı" (m) bu aralığa sıkıştırılır. OSRM aday yolları 3×yarıçap içinde
//   arar ve yakınlığı bu yarıçapa göre puanlar. Yayada taban geniş: bina dibinde GPS 30-40 m yana kayabiliyor
//   (telefon ±5 m dese bile) — asıl caddenin de aday listesine girmesi gerekir.
//   maxAcc: bundan kaba noktalar (bina içi, Wi-Fi konumu) eşleştirmeye katılmaz — yanlış yola çekiyorlar
//   gaps: 'split' = uzun zaman boşluğunda izi böl (arası kesikli), 'ignore' = boşluğu yol ağı üstünden bağla
//         (araçta durakta/ışıkta nokta gelmez → bölünmesin; gerçek kayıtla: otobüste 10 boşluk → 0)
// Ayarlar 30 Eyl gerçek kaydıyla seçildi (scripts/snap-tune.mjs): yaya rMin 12→20 yürüyüşün başındaki
// bina-içi noktaların dolambaçlı yola çekilmesini önledi, maxAcc süzgeci sahte uzamayı kaldırdı (882→621 m).
const PROF = {
  walk: { net: 'foot', gap: 6, rMin: 20, rMax: 40, maxAcc: 30, gaps: 'split' },
  bike: { net: 'foot', gap: 8, rMin: 20, rMax: 40, maxAcc: 30, gaps: 'split' },
  car: { net: 'car', gap: 15, rMin: 10, rMax: 50, maxAcc: 60, gaps: 'ignore' },
  bus: { net: 'car', gap: 15, rMin: 12, rMax: 50, maxAcc: 60, gaps: 'ignore' },
};
const CHUNK = 300;       // tek OSRM isteğindeki en çok nokta (URL uzunluğu); dilimler sınır noktasını paylaşır
const MAX_LEGS = 30, MAX_PTS = 5000, MAX_BODY = 3e6;
const GAP_DASH = 30;     // m — iki eşleşme arasındaki boşluk bundan uzunsa kesikli çizilir

const RAD = Math.PI / 180;
// İki [lat, lon] noktası arası metre
function hav(a, b) {
  const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Motor çöktü / ulaşılamıyor: telefon bu durumda sonucu saklamaz, sonra yeniden sorar (503).
class EngineDown extends Error {}

// Tek dilim için OSRM /match. Veri kaynaklı hata (eşleşme yok vb.) boş sonuç ya da Error; motor yoksa EngineDown.
async function osrmMatch(net, pts, P) {
  const coords = pts.map((q) => q[1].toFixed(6) + ',' + q[0].toFixed(6)).join(';');
  const ts = pts.map((q) => q[2]).join(';');
  const rad = pts.map((q) => Math.round(Math.min(P.rMax, Math.max(P.rMin, q[3] == null ? P.rMax : q[3])))).join(';');
  const url = OSRM[net] + '/match/v1/x/' + coords + '?timestamps=' + ts + '&radiuses=' + rad + '&geometries=geojson&overview=full&gaps=' + P.gaps + '&tidy=false';
  let j;
  try { j = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json(); } catch (e) { throw new EngineDown(net + ': ' + e.message); }
  if (j.code === 'Ok') return j;
  if (j.code === 'NoMatch' || j.code === 'NoSegment') return { matchings: [], tracepoints: pts.map(() => null) };
  throw new Error('osrm ' + j.code);
}

// Bir yolculuk parçasını yola oturt.
async function matchLeg(leg) {
  const id = leg && leg.id, P = leg && PROF[leg.m];
  if (!P || !Array.isArray(leg.p)) return { id, ok: false, why: 'tur' };
  // 1) geçerli noktalar, zaman sırası, tam saniye. Kaba noktalar (maxAcc üstü) atılır; atınca geriye
  //    çok az nokta kalıyorsa (parça baştan sona kaba) ±100 m'ye kadar olanlarla yetinilir.
  const all = leg.p
    .filter((q) => Array.isArray(q) && q.length >= 3 && Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]) && Math.abs(q[0]) <= 90 && Math.abs(q[1]) <= 180 && !(q[3] > 100))
    .map((q) => [q[0], q[1], Math.round(q[2]), Number.isFinite(q[3]) ? q[3] : null])
    .sort((a, b) => a[2] - b[2]);
  const fine = all.filter((q) => !(q[3] > P.maxAcc));
  const src = fine.length >= Math.max(3, all.length * 0.3) ? fine : all;
  // 2) seyrelt: öncekine çok yakın noktayı at (son nokta her zaman kalır). OSRM zamanı artan ister.
  const pts = [];
  for (let i = 0; i < src.length; i++) {
    const q = src[i], last = pts[pts.length - 1];
    if (last && q[2] <= last[2]) continue;
    if (last && i < src.length - 1 && hav(last, q) < P.gap && q[2] - last[2] < 30) continue;
    pts.push(q);
  }
  if (pts.length < 3) return { id, ok: false, why: 'az' };
  if (pts.length > MAX_PTS) return { id, ok: false, why: 'cok' };

  // 3) OSRM'e CHUNK'lık dilimlerle sor; ardışık dilimler sınır noktasını paylaşır (çizgi kopmasın).
  const ms = []; // eşleşmeler, iz sırasıyla: {c: [[lat, lon], ...], d: metre}
  let hit = 0;
  try {
    for (let s = 0; s < pts.length - 1; s += CHUNK - 1) {
      const part = pts.slice(s, s + CHUNK);
      const r = await osrmMatch(P.net, part, P);
      r.tracepoints.forEach((tp, i) => { if (tp && !(s > 0 && i === 0)) hit++; }); // sınır noktası bir kez sayılır
      for (const m of r.matchings) ms.push({ c: m.geometry.coordinates.map(([lo, la]) => [la, lo]), d: m.distance });
    }
  } catch (e) {
    if (e instanceof EngineDown) throw e;
    return { id, ok: false, why: 'hata' };
  }
  const cover = hit / pts.length;
  if (!ms.length || cover < 0.5) return { id, ok: false, why: 'eslesmedi', cover: +cover.toFixed(2) };

  // 4) çizgi: eşleşmeler sırayla. Aralarındaki kısa boşluk çizgiye katılır; uzunsa ayrı, kesikli parça olur.
  const parts = [];
  let cur = null, d = 0;
  for (const m of ms) {
    if (cur) {
      const a = cur.c[cur.c.length - 1], b = m.c[0], gd = hav(a, b);
      d += gd;
      if (gd > GAP_DASH) { parts.push({ g: 1, c: [a, b] }); cur = null; }
    }
    if (!cur) { cur = { g: 0, c: [] }; parts.push(cur); }
    for (const q of m.c) cur.c.push(q);
    d += m.d;
  }

  // 5) sağlama: yol üstündeki uzunluk GPS izinin uzunluğunu çok aşıyorsa eşleştirme dolambaçlı bir yol
  //    uydurmuş demektir (tek yön, haritada eksik geçit...) → kabul etme; telefon kendi düzeltmesiyle çizer.
  let raw = 0;
  for (let i = 1; i < pts.length; i++) raw += hav(pts[i - 1], pts[i]);
  if (d > raw * 1.35 + 80) return { id, ok: false, why: 'dolambac', d: Math.round(d), raw: Math.round(raw) };
  return { id, ok: true, d: Math.round(d), cover: +cover.toFixed(2), parts };
}

// Aynı anda en çok 2 istek işlenir (sunucudaki diğer servisler yavaşlamasın); fazlası sırada bekler.
let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= 2) await new Promise((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; const n = waiting.shift(); if (n) n(); }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('büyük')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Anahtar karşılaştırması sabit sürede (zamanlamadan tahmin edilemesin)
function keyOk(k) {
  const a = Buffer.from(String(k || '')), b = Buffer.from(KEY);
  return KEY.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

const HEAD = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  // web önizlemesi (tarayıcı) de sorabilsin; anahtar yine gerekli
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-iz-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const send = (res, code, obj) => { res.writeHead(code, HEAD); res.end(obj == null ? '' : JSON.stringify(obj)); };

// Modül olarak yüklenirse (ayar denemesi: scripts/snap-tune.mjs) yalnız eşleştirme fonksiyonları verilir.
module.exports = { matchLeg, PROF, hav };
if (require.main === module) http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'OPTIONS') return send(res, 204, null);
    if (req.method === 'GET' && url === '/v1/health') {
      // Bakü merkezinde "en yakın yol" sorusu: iki motor da cevap veriyorsa ayakta
      const ping = async (net) => { try { return (await (await fetch(OSRM[net] + '/nearest/v1/x/49.8671,40.4093', { signal: AbortSignal.timeout(3000) })).json()).code === 'Ok'; } catch (e) { return false; } };
      const foot = await ping('foot'), car = await ping('car');
      return send(res, foot && car ? 200 : 503, { ok: foot && car, v: V, foot, car });
    }
    if (req.method === 'GET' && url === '/v1/busstops') {
      if (!keyOk(req.headers['x-iz-key'])) return send(res, 401, { error: 'anahtar' });
      let b;
      try { b = fs.readFileSync(path.join(__dirname, 'data', 'stops.json')); } catch (e) { return send(res, 404, { error: 'durak listesi yok' }); }
      res.writeHead(200, HEAD); return res.end(b);
    }
    if (req.method !== 'POST' || url !== '/v1/match') return send(res, 404, { error: 'yok' });
    if (!keyOk(req.headers['x-iz-key'])) return send(res, 401, { error: 'anahtar' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'gövde' }); }
    const legs = body && Array.isArray(body.legs) ? body.legs : null;
    if (!legs || !legs.length || legs.length > MAX_LEGS) return send(res, 400, { error: 'legs' });
    const t0 = Date.now();
    const out = await slot(async () => { const r = []; for (const l of legs) r.push(await matchLeg(l)); return r; });
    // Log: yalnız sayılar — konum ASLA yazılmaz
    console.log(new Date().toISOString(), 'match', legs.length, 'parça,', out.filter((x) => x.ok).length, 'oturdu,', Date.now() - t0, 'ms');
    return send(res, 200, { v: V, legs: out });
  } catch (e) {
    if (e instanceof EngineDown) { console.error('motor yok:', e.message); return send(res, 503, { error: 'motor' }); }
    console.error('hata:', e && e.message);
    return send(res, 500, { error: 'hata' });
  }
}).listen(PORT, '127.0.0.1', () => console.log('iz-harita dinliyor 127.0.0.1:' + PORT, KEY ? '' : '(UYARI: IZ_KEY yok, tüm istekler reddedilir)'));
