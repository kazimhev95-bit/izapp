// Canlı veri aktarımı servisini uçtan uca dener (geçici bir sınama cihazıyla):
//   node scripts/sync-test.mjs
// Kayıt → satır yolla (bozuk satır dahil) → tekrar yolla (çift kayıt olmamalı) → meta → durum → aralık silme →
// yanlış anahtar / kimlik denemeleri → hepsini sil. Sınama cihazı sonunda sunucudan elle kaldırılır (çıktıdaki komut).
import fs from 'fs';
import crypto from 'crypto';

const KEY = (fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/EXPO_PUBLIC_IZ_KEY=(.+)/) || [])[1]?.trim();
const BASE = 'https://iz.80-240-17-26.sslip.io/v1/sync';
const dev = crypto.randomBytes(16).toString('hex'), sec = crypto.randomBytes(32).toString('hex');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'GEÇTİ ' : 'KALDI ') + m); if (!c) fails++; };
async function call(path, body, { key = KEY, auth = dev + '.' + sec, method } = {}) {
  const h = { 'content-type': 'application/json' };
  if (key) h['x-iz-key'] = key;
  if (auth) h.authorization = 'Bearer ' + auth;
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* boş */ }
  return { s: r.status, j, hsts: r.headers.get('strict-transport-security') };
}

const t0 = Date.UTC(2026, 9, 1, 8, 0, 0);
let r = await call('/register', { dev, sec, info: 'sınama' }, { auth: null });
ok(r.s === 200 && r.j.ok, 'kayıt 200');
ok(!!r.hsts, 'HSTS başlığı var');
r = await call('/register', { dev, sec, info: 'sınama' }, { auth: null });
ok(r.s === 200 && r.j.again, 'aynı kimlikle yeniden kayıt = again');
r = await call('/register', { dev, sec: crypto.randomBytes(32).toString('hex') }, { auth: null });
ok(r.s === 409, 'aynı cihaz kimliği başka anahtarla alınamaz (409)');

const pts = Array.from({ length: 1500 }, (_, i) => [t0 + i * 1000, 40.4093 + i * 1e-5, 49.8671 + i * 1e-5, 5, 1.4, 90, 1012.3]);
r = await call('/push', { tb: 'p', rows: [...pts, [t0, 'x'], [1, 40, 49, null, null, null, null], [t0 + 5000, 95, 49, 5, null, null, null]] });
ok(r.s === 200 && r.j.n === 1500 && r.j.bad === 3, 'konum: 1500 kaydedildi, 3 bozuk atıldı (' + JSON.stringify(r.j) + ')');
r = await call('/push', { tb: 'p', rows: pts.slice(0, 500) });
ok(r.s === 200 && r.j.n === 500, 'aynı satırlar yeniden: üstüne yazıldı');
r = await call('/push', { tb: 'a', rows: [[t0, 'W', 2], [t0 + 60e3, 'A', 1], [t0 + 60e3, 'A', 2]] });
ok(r.s === 200 && r.j.n === 2, 'hareket: aynı t iki kez → tek satır');
r = await call('/push', { tb: 'b', rows: [[t0, 87, 0, 'high'], [t0 + 600e3, -100, 1, null]] });
ok(r.s === 200 && r.j.n === 2, 'pil');
r = await call('/push', { tb: 'l', rows: [[1, t0, 'ayar', 'profil: birebir'], [2, t0, 'düğme', null], [3, t0 + 1, 'uzun', 'x'.repeat(9000)]] });
ok(r.s === 200 && r.j.n === 3, 'günlük (aynı ms iki satır ayrı)');
r = await call('/push', { tb: 'm', rows: [] });
ok(r.s === 400, "push ile 'm' tablosu yazılamaz");
r = await call('/push', { tb: 'p', rows: Array.from({ length: 2001 }, () => pts[0]) });
ok(r.s === 400, '2001 satır reddedildi');
r = await call('/meta', { places: [{ id: 1, lat: 40.4, lon: 49.8, name: 'Ev', kind: 'home' }], overrides: { [t0]: 'bus' }, kv: { profile: '"birebir"' } });
ok(r.s === 200, 'meta');
r = await call('/status');
ok(r.s === 200 && r.j.n.p === 1500 && r.j.n.a === 2 && r.j.n.b === 2 && r.j.n.l === 3 && r.j.n.m === 1, 'durum: ' + JSON.stringify(r.j.n));

// Kimlik denemeleri
r = await call('/status', null, { key: 'yanlis' });
ok(r.s === 401, 'yanlış uygulama anahtarı 401');
r = await call('/status', null, { auth: dev + '.' + crypto.randomBytes(32).toString('hex') });
ok(r.s === 401, 'yanlış cihaz anahtarı 401');
r = await call('/status', null, { auth: crypto.randomBytes(16).toString('hex') + '.' + sec });
ok(r.s === 401, 'olmayan cihaz 401');

// Aralıkla silme: ilk 10 dk
r = await call('/wipe', { from: t0, to: t0 + 600e3 });
ok(r.s === 200 && r.j.deleted > 0, 'aralık silme: ' + r.j?.deleted + ' satır');
r = await call('/status');
ok(r.j.n.p === 900, 'aralık sonrası konum 900 (' + r.j.n.p + ')');
console.log('\nŞimdi sunucuda dışa aktarma denenebilir:  admin.js export ' + dev.slice(0, 10) + ' 2026-10-01');
if (process.argv[2] !== 'keep') {
  r = await call('/wipe', {});
  r = await call('/status');
  ok(r.s === 200 && !Object.keys(r.j.n).length, 'hepsini sil → sunucuda bu cihaza ait satır yok');
}
console.log('\nsınama cihazı: ' + dev + (fails ? '\n' + fails + ' KALDI' : '\nTÜMÜ GEÇTİ'));
