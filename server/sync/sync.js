'use strict';
// İZ veri aktarımı (sunucu yedeği) — telefon kayıtlarını saklayan servis. 127.0.0.1:3703, nginx arkasında
// https://iz.80-240-17-26.sslip.io/v1/sync/...
//
//   POST /v1/sync/register  x-iz-key          {dev, sec, info}  yeni cihaz (dev 32 hex, sec 64 hex — telefonda üretilir)
//   POST /v1/sync/push      x-iz-key + Bearer {tb, rows}        tb: p konum, a hareket, b pil, l olay günlüğü
//   POST /v1/sync/meta      x-iz-key + Bearer {places, overrides, kv}  yer adları / tür düzeltmeleri / ayarlar (değişince)
//   GET  /v1/sync/status    x-iz-key + Bearer  sunucudaki satır sayıları
//   POST /v1/sync/wipe      x-iz-key + Bearer {from?, to?}      bu cihazın sunucudaki verisini sil (hepsi ya da aralık)
//   GET  /v1/sync/health    veritabanı ayakta mı
//   (Bearer = "Bearer <dev>.<sec>")
//
// Güvenlik katmanları:
//  1) Yalnız HTTPS (nginx + Let's Encrypt); servis yalnız 127.0.0.1'i dinler.
//  2) Her telefonun kendi 256 bitlik gizli anahtarı var (telefonda iOS Anahtarlık'ta, yalnız o cihaz). Sunucu
//     anahtarın yalnız SHA-256 özetini tutar, sabit sürede karşılaştırır. Bir cihaz yalnız KENDİ verisine
//     yazar / bakar / siler; başka cihazın verisine giden bir yol yok.
//  3) Yeni cihaz yalnız uygulama anahtarıyla ve en çok MAX_DEVICES tane kaydolur; REGISTER=0 kaydı tamamen kapatır.
//  4) Satırlar AES-256-GCM ile şifreli (lib.js); anahtar .env'de. Düz duran yalnız zaman damgası (aralıkla silme
//     ve sıralama için).
//  5) Ayrı veritabanı + rol, parolasız peer bağlantısı; süreç yetkisiz 'izsync' kullanıcısıyla çalışır (CRM vb.
//     diğer uygulamaların dosyalarını okuyamaz), kodu değiştiremez (dosyalar root'un).
//  6) Hiçbir istek gövdesi / koordinat günlüğe yazılmaz — yalnız sayılar (nginx'te access_log de kapalı).
//  7) Sınırlar: gövde ≤ 1 MB, istek başına ≤ 2000 satır, cihaz başına günde ≤ 300 000 satır; bir IP'den
//     15 dk içinde 10 hatalı kimlik → 15 dk kilit.
const http = require('http');
const crypto = require('crypto');
const { pool, seal, sha256 } = require('./lib');

const PORT = Number(process.env.PORT) || 3703;
const APP_KEY = process.env.IZ_KEY || '';
const MAX_DEVICES = Number(process.env.MAX_DEVICES) || 2;
const REGISTER = process.env.REGISTER !== '0';
const MAX_BODY = 1e6, MAX_ROWS = 2000, DAY_ROWS = 300000;
const FAIL_N = 10, FAIL_MS = 15 * 60e3;

// ---- Doğrulama ----
// Telefonun yolladığı satırlar (dizi) tek tek denetlenir; bozuk satır atılır (sayısı cevapta 'bad'), istek
// reddedilmez — yoksa telefondaki tek bozuk satır kuyruğu sonsuza dek tıkardı.
// Dönüş: {k: tablo içi benzersiz anahtar, t: zaman (ms), d: şifrelenecek değerler} ya da null.
const T_MIN = Date.UTC(2020, 0, 1);
const okT = (t) => Number.isSafeInteger(t) && t >= T_MIN && t <= Date.now() + 86400e3;
const num = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7);
const int = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const str = (v, n) => v === null || (typeof v === 'string' && v.length <= n);
const TABLES = {
  // konum: [t, lat, lon, acc, spd, crs, hpa]
  p: (r) => (r.length === 7 && okT(r[0]) && typeof r[1] === 'number' && Math.abs(r[1]) <= 90 && typeof r[2] === 'number' && Math.abs(r[2]) <= 180 && r.slice(3).every(num)
    ? { k: r[0], t: r[0], d: r.slice(1) } : null),
  // hareket: [t, tür harfi, güven 0-3]
  a: (r) => (r.length === 3 && okT(r[0]) && typeof r[1] === 'string' && /^[A-Z]$/.test(r[1]) && int(r[2], 0, 3)
    ? { k: r[0], t: r[0], d: [r[1], r[2]] } : null),
  // pil: [t, seviye %, şarjda 0/1, GPS kipi]  (seviye bilinmiyorsa telefon -100 yazar)
  b: (r) => (r.length === 4 && okT(r[0]) && int(r[1], -100, 100) && int(r[2], 0, 3) && str(r[3], 12)
    ? { k: r[0], t: r[0], d: [r[1], r[2], r[3]] } : null),
  // olay günlüğü: [id, t, tür, değer]. Anahtar t*1000 + id%1000: uygulama silinip kurulunca id 1'den başlar,
  // aynı id eski bir satırın üstüne yazmasın (aynı milisaniyede 1000 farklı id olamaz).
  l: (r) => (r.length === 4 && Number.isSafeInteger(r[0]) && r[0] >= 0 && okT(r[1]) && typeof r[2] === 'string' && r[2].length <= 40 && (r[3] === null || typeof r[3] === 'string')
    ? { k: r[1] * 1000 + (r[0] % 1000), t: r[1], d: [r[0], r[2], r[3] == null ? null : r[3].slice(0, 4000)] } : null),
};

// ---- Kimlik ----
// Hatalı kimlik sayacı (IP başına). nginx gerçek istemci adresini X-Real-IP'de verir.
const fails = new Map();
const ipOf = (req) => String(req.headers['x-real-ip'] || req.socket.remoteAddress || '?');
const blocked = (ip) => { const f = fails.get(ip); return !!f && f.until > Date.now(); };
function fail(ip) {
  const now = Date.now();
  let f = fails.get(ip);
  if (!f || now - f.first > FAIL_MS) f = { n: 0, first: now, until: 0 };
  if (++f.n >= FAIL_N) { f.until = now + FAIL_MS; console.log(new Date().toISOString(), 'kilit: çok hatalı kimlik'); }
  fails.set(ip, f);
  if (fails.size > 5000) for (const [k, v] of fails) if (now - v.first > FAIL_MS && v.until < now) fails.delete(k); // bellek şişmesin
}
// Uygulama anahtarı (x-iz-key) sabit sürede karşılaştırılır
function appKeyOk(req) {
  const a = Buffer.from(String(req.headers['x-iz-key'] || '')), b = Buffer.from(APP_KEY);
  return APP_KEY.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Cihaz önbelleği (60 sn): iptal yönetim aracından yapılınca en geç bir dakikada geçerli olur
const devs = new Map(); // id -> {n, h, revoked, at}
async function devOf(id) {
  const c = devs.get(id);
  if (c && Date.now() - c.at < 60e3) return c;
  const r = await pool.query('SELECT n, h, revoked FROM dev WHERE id = $1', [id]);
  if (!r.rows[0]) { devs.delete(id); return null; }
  const d = { ...r.rows[0], at: Date.now() };
  devs.set(id, d);
  return d;
}
// "Bearer <dev>.<sec>" → cihaz satırı ya da null
async function auth(req) {
  const m = /^Bearer ([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(String(req.headers.authorization || ''));
  if (!m) return null;
  const d = await devOf(m[1]);
  if (!d || d.revoked) return null;
  return crypto.timingSafeEqual(sha256(m[2]), d.h) ? d : null;
}
// Son görülme (en çok 5 dk'da bir yazılır) ve günlük satır kotası (bellekte)
const seen = new Map(), quota = new Map();
function touch(d) {
  const now = Date.now();
  if (now - (seen.get(d.n) || 0) < 5 * 60e3) return;
  seen.set(d.n, now);
  pool.query('UPDATE dev SET seen = now() WHERE n = $1', [d.n]).catch(() => {});
}
function overQuota(d, n) {
  const day = Math.floor(Date.now() / 86400e3), q = quota.get(d.n);
  const cur = q && q.day === day ? q : { day, n: 0 };
  if (cur.n + n > DAY_ROWS) return true;
  cur.n += n; quota.set(d.n, cur);
  return false;
}

// ---- HTTP ----
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('büyük')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const HEAD = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const send = (res, code, obj) => { res.writeHead(code, HEAD); res.end(JSON.stringify(obj)); };
const log = (...a) => console.log(new Date().toISOString(), ...a); // YALNIZ sayılar / kısa kimlik — konum asla
const short = (id) => String(id).slice(0, 8);

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0], ip = ipOf(req);
  try {
    if (req.method === 'GET' && url === '/v1/sync/health') {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true });
    }
    if (blocked(ip)) return send(res, 429, { error: 'kilit' });
    if (!appKeyOk(req)) { fail(ip); return send(res, 401, { error: 'anahtar' }); }

    // Yeni cihaz kaydı: telefon kendi kimliğini ve gizli anahtarını üretir, sunucu yalnız özetini saklar.
    if (req.method === 'POST' && url === '/v1/sync/register') {
      let b;
      try { b = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'gövde' }); }
      if (!b || !/^[0-9a-f]{32}$/.test(b.dev || '') || !/^[0-9a-f]{64}$/.test(b.sec || '')) return send(res, 400, { error: 'kimlik' });
      const h = sha256(b.sec);
      const ex = (await pool.query('SELECT n, h, revoked FROM dev WHERE id = $1', [b.dev])).rows[0];
      if (ex) {
        if (ex.revoked) return send(res, 403, { error: 'iptal' });
        if (crypto.timingSafeEqual(h, ex.h)) return send(res, 200, { ok: true, again: true }); // aynı telefon yeniden soruyor
        fail(ip); return send(res, 409, { error: 'çakışma' });                               // başkasının kimliğini alamaz
      }
      if (!REGISTER) return send(res, 403, { error: 'kapalı' });
      const info = typeof b.info === 'string' ? b.info.slice(0, 80) : null;
      // Sınır tek sorguda: etkin cihaz sayısı MAX_DEVICES'a ulaştıysa satır eklenmez
      const r = await pool.query('INSERT INTO dev (id, h, info) SELECT $1, $2, $3 WHERE (SELECT count(*) FROM dev WHERE NOT revoked) < $4 RETURNING n', [b.dev, h, info, MAX_DEVICES]);
      if (!r.rows[0]) { log('kayıt reddedildi: cihaz sınırı', MAX_DEVICES); return send(res, 403, { error: 'dolu' }); }
      log('yeni cihaz', short(b.dev), 'n=' + r.rows[0].n);
      return send(res, 200, { ok: true });
    }

    // Buradan sonrası cihaz kimliği ister
    const d = await auth(req);
    if (!d) { fail(ip); return send(res, 401, { error: 'kimlik' }); }
    touch(d);

    if (req.method === 'POST' && url === '/v1/sync/push') {
      let b;
      try { b = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'gövde' }); }
      const V = b && TABLES[b.tb];
      if (!V || !Array.isArray(b.rows) || b.rows.length > MAX_ROWS) return send(res, 400, { error: 'tablo' });
      if (overQuota(d, b.rows.length)) { log('kota doldu n=' + d.n); return send(res, 429, { error: 'kota' }); }
      // Aynı anahtar bir istekte iki kez gelirse sonuncusu (ON CONFLICT aynı satırı iki kez güncelleyemez)
      const m = new Map(); let bad = 0;
      for (const r of b.rows) { const x = Array.isArray(r) ? V(r) : null; if (x) m.set(x.k, x); else bad++; }
      const ks = [], ts = [], ds = [];
      for (const x of m.values()) { ks.push(x.k); ts.push(x.t); ds.push(seal(d.n, b.tb, x.k, x.d)); }
      // Aynı satır yeniden gelirse üstüne yazılır (telefon gönderdi ama cevabı alamadıysa tekrar yollar)
      if (ks.length) {
        await pool.query(
          'INSERT INTO rec (dev, tb, k, t, d) SELECT $1, $2, u.k, u.t, u.d FROM unnest($3::bigint[], $4::bigint[], $5::bytea[]) AS u(k, t, d) ' +
          'ON CONFLICT (dev, tb, k) DO UPDATE SET t = excluded.t, d = excluded.d',
          [d.n, b.tb, ks, ts, ds]);
      }
      if (bad) log('push', b.tb, 'bozuk satır', bad, 'n=' + d.n);
      return send(res, 200, { ok: true, n: ks.length, bad });
    }

    // Yerler / tür düzeltmeleri / ayarlar: her değişiklik ayrı bir anlık görüntü olarak saklanır (tablo 'm',
    // anahtar = sunucu saati). Telefonda "Tüm veriyi sil" yapılsa bile eski adlar sunucuda kaybolmaz.
    if (req.method === 'POST' && url === '/v1/sync/meta') {
      let b;
      try { b = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'gövde' }); }
      if (!b || !Array.isArray(b.places) || b.places.length > 5000 || typeof b.overrides !== 'object' || typeof b.kv !== 'object') return send(res, 400, { error: 'meta' });
      const t = Date.now();
      await pool.query('INSERT INTO rec (dev, tb, k, t, d) VALUES ($1, $2, $3, $3, $4) ON CONFLICT (dev, tb, k) DO UPDATE SET d = excluded.d',
        [d.n, 'm', t, seal(d.n, 'm', t, { places: b.places, overrides: b.overrides, kv: b.kv })]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url === '/v1/sync/status') {
      const r = await pool.query('SELECT tb, count(*)::int AS n, min(t) AS a, max(t) AS b FROM rec WHERE dev = $1 GROUP BY tb', [d.n]);
      const n = {}; let first = null, last = null;
      for (const x of r.rows) {
        n[x.tb] = x.n;
        if (x.tb !== 'm') { first = first == null ? +x.a : Math.min(first, +x.a); last = last == null ? +x.b : Math.max(last, +x.b); }
      }
      return send(res, 200, { ok: true, n, first, last });
    }

    // Silme: gövdede from/to (ms) varsa yalnız o aralık, yoksa bu cihazın sunucudaki HER ŞEYİ.
    // Ayrı yedek kopya tutulmadığı için silinen veri geri gelmez.
    if (req.method === 'POST' && url === '/v1/sync/wipe') {
      let b = {};
      try { b = JSON.parse((await readBody(req)) || '{}') || {}; } catch (e) { return send(res, 400, { error: 'gövde' }); }
      const range = okT(b.from) && okT(b.to) && b.from < b.to;
      const r = range
        ? await pool.query('DELETE FROM rec WHERE dev = $1 AND t >= $2 AND t < $3', [d.n, b.from, b.to])
        : await pool.query('DELETE FROM rec WHERE dev = $1', [d.n]);
      log('silindi n=' + d.n, range ? 'aralık' : 'hepsi', r.rowCount, 'satır');
      return send(res, 200, { ok: true, deleted: r.rowCount });
    }

    return send(res, 404, { error: 'yok' });
  } catch (e) {
    if (e && e.message === 'büyük') return send(res, 413, { error: 'büyük' });
    console.error(new Date().toISOString(), 'hata:', e && e.message); // ileti yalnız; gövde/veri asla
    return send(res, 500, { error: 'hata' });
  }
});
server.requestTimeout = 30e3;
server.headersTimeout = 10e3;
server.listen(PORT, '127.0.0.1', () => log('iz-sync dinliyor 127.0.0.1:' + PORT, '· kayıt', REGISTER ? 'açık (en çok ' + MAX_DEVICES + ' cihaz)' : 'KAPALI', APP_KEY ? '' : '(UYARI: IZ_KEY yok, tüm istekler reddedilir)'));
