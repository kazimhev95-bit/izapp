// Yerel veri deposu (SQLite) — tüm kayıtlar SADECE telefonda saklanır. (Yola oturtma açıkken bitmiş
// yolculuk noktaları eşleştirme için kendi sunucumuza gider ama orada saklanmaz — bkz. snap.js)
// Web önizlemesi için eşdeğeri: store.web.js (aynı fonksiyon imzaları).
import * as SQLite from 'expo-sqlite';

let _db = null;
function db() {
  if (_db) return _db;
  _db = SQLite.openDatabaseSync('iz.db');
  // WAL: arka plan görevi yazarken arayüz okuyabilsin.
  _db.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS points (t INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, acc REAL, spd REAL);
    CREATE TABLE IF NOT EXISTS places (id INTEGER PRIMARY KEY AUTOINCREMENT, lat REAL NOT NULL, lon REAL NOT NULL, name TEXT, kind TEXT, addr TEXT);
    CREATE TABLE IF NOT EXISTS overrides (t0 INTEGER PRIMARY KEY, mode TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS stat (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, last INTEGER);
    CREATE TABLE IF NOT EXISTS activity (t INTEGER PRIMARY KEY, k TEXT NOT NULL, c INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS snap (k TEXT PRIMARY KEY, ok INTEGER NOT NULL, v TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, k TEXT NOT NULL, v TEXT);
    CREATE TABLE IF NOT EXISTS battery (t INTEGER PRIMARY KEY, lvl INTEGER NOT NULL, chg INTEGER NOT NULL DEFAULT 0, mode TEXT);
    CREATE TABLE IF NOT EXISTS tile (k TEXT PRIMARY KEY, b TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  // Şema yükseltme: eski kurulumlarda points tablosunda gidiş yönü (crs) sütunu yok — ekle.
  const cols = _db.getAllSync('PRAGMA table_info(points)').map((c) => c.name);
  if (!cols.includes('crs')) _db.execSync('ALTER TABLE points ADD COLUMN crs REAL;');
  if (!cols.includes('hpa')) _db.execSync('ALTER TABLE points ADD COLUMN hpa REAL;'); // barometre basıncı (hPa)
  return _db;
}

// Arka plan görevinden çağrılır: aynı zaman damgası ikinci kez gelirse yok sayılır.
export function insertPoints(arr) {
  if (!arr.length) return;
  const d = db();
  d.withTransactionSync(() => {
    for (const p of arr) d.runSync('INSERT OR IGNORE INTO points (t, lat, lon, acc, spd, crs, hpa) VALUES (?, ?, ?, ?, ?, ?, ?)', p.t, p.lat, p.lon, p.acc ?? null, p.spd ?? null, p.crs ?? null, p.hpa ?? null);
  });
}
// step (ms) verilirse her step'lik dilimden yalnız ilk nokta okunur — uzun dönem analizinde
// (hafta/ay) yüz binlerce noktayı belleğe almamak için. Harita (tek gün) step'siz, tam okur.
export function getPoints(a, b, step = 0) {
  if (!step) return db().getAllSync('SELECT t, lat, lon, acc, spd, crs, hpa FROM points WHERE t >= ? AND t < ? ORDER BY t', a, b);
  return db().getAllSync('SELECT MIN(t) AS t, lat, lon, acc, spd, crs, hpa FROM points WHERE t >= ? AND t < ? GROUP BY t / ? ORDER BY t', a, b, step);
}
// Aralıktaki verinin "sürümü": nokta sayısı + son zaman. Değişmediyse analizi yeniden yapmaya gerek yok.
export function rangeVersion(a, b) { const r = db().getFirstSync('SELECT COUNT(*) AS n, MAX(t) AS m FROM points WHERE t >= ? AND t < ?', a, b); return r.n + ':' + (r.m || 0); }
export function pointStats() { return db().getFirstSync('SELECT COUNT(*) AS n, MIN(t) AS first, MAX(t) AS last FROM points'); }

export function getPlaces() { return db().getAllSync('SELECT id, lat, lon, name, kind, addr FROM places'); }
export function addPlace(pl) { return db().runSync('INSERT INTO places (lat, lon, name, kind, addr) VALUES (?, ?, ?, ?, ?)', pl.lat, pl.lon, pl.name ?? null, pl.kind ?? null, pl.addr ?? null).lastInsertRowId; }
export function updatePlace(id, name, kind) { db().runSync('UPDATE places SET name = ?, kind = ? WHERE id = ?', name || null, kind || null, id); }

export function getOverrides() { const o = {}; for (const r of db().getAllSync('SELECT t0, mode FROM overrides')) o[r.t0] = r.mode; return o; }
export function setOverride(t0, mode) {
  if (mode) db().runSync('INSERT OR REPLACE INTO overrides (t0, mode) VALUES (?, ?)', t0, mode);
  else db().runSync('DELETE FROM overrides WHERE t0 = ?', t0);
}

export function getKV(k, def = null) { const r = db().getFirstSync('SELECT v FROM kv WHERE k = ?', k); return r ? JSON.parse(r.v) : def; }
export function setKV(k, v) { db().runSync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, JSON.stringify(v)); }

// Hareket kayıtları (telefonun hareket işlemcisi: araçta / yürüyor / bisiklet / duruyor).
export function insertActivity(t, k, c) { db().runSync('INSERT OR REPLACE INTO activity (t, k, c) VALUES (?, ?, ?)', t, k, c); }
export function getActivity(a, b) { return db().getAllSync('SELECT t, k, c FROM activity WHERE t >= ? AND t < ? ORDER BY t', a, b); }

// Sayaçlar (tanı): hangi kaynaktan, uygulama hangi durumdayken kaç olay geldi ve en son ne zaman.
export function bumpStat(k, n, t) {
  db().runSync('INSERT INTO stat (k, n, last) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET n = n + excluded.n, last = excluded.last', k, n, t);
}
export function getStats() { const o = {}; for (const r of db().getAllSync('SELECT k, n, last FROM stat')) o[r.k] = { n: r.n, last: r.last }; return o; }

// Yola oturtma sonuçları (sunucudan): parça anahtarı -> {ok, parts} | {ok:false, why}.
// Analiz dakikada bir çalıştığı için bulunan sonuçlar bellekte de tutulur.
const snapMem = new Map();
export function getSnap(k) {
  if (snapMem.has(k)) return snapMem.get(k);
  const r = db().getFirstSync('SELECT v FROM snap WHERE k = ?', k);
  if (!r) return null;
  const v = JSON.parse(r.v);
  snapMem.set(k, v);
  return v;
}
export function setSnaps(rows) {
  if (!rows.length) return;
  const d = db(), now = Date.now();
  d.withTransactionSync(() => { for (const [k, v] of rows) d.runSync('INSERT OR REPLACE INTO snap (k, ok, v, at) VALUES (?, ?, ?, ?)', k, v.ok ? 1 : 0, JSON.stringify(v), now); });
  for (const [k, v] of rows) snapMem.set(k, v);
}
export function snapStats() { const r = db().getFirstSync('SELECT SUM(ok) AS ok, COUNT(*) AS n FROM snap'); return { ok: r.ok || 0, fail: (r.n || 0) - (r.ok || 0) }; }
export function clearSnaps() { db().execSync('DELETE FROM snap;'); snapMem.clear(); }

// Olay günlüğü (log): bastığın düğmeler, ayar değişiklikleri, tür düzeltmeleri, uygulama/kayıt/GPS olayları — saatle,
// tek tek. Dışa aktarılan dosyaya girer (sonradan "ne oldu, kim ne yaptı" sırayla okunabilsin). 30 günden eskisi silinir.
let logN = 0;
export function addLog(k, v) {
  try {
    const d = db();
    d.runSync('INSERT INTO log (t, k, v) VALUES (?, ?, ?)', Date.now(), k, v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
    if (++logN % 200 === 1) d.runSync('DELETE FROM log WHERE t < ?', Date.now() - 30 * 86400e3);
  } catch (e) { /* günlük yazılamasa da uygulama durmasın */ }
}
export function getLogs(a, b, limit = 100000) { return db().getAllSync('SELECT t, k, v FROM log WHERE t >= ? AND t < ? ORDER BY t DESC, id DESC LIMIT ?', a, b, limit); }
export function logCount() { return db().getFirstSync('SELECT COUNT(*) AS n FROM log').n; }

// Pil ölçümleri (pil raporu): 10 dk'da bir seviye, şarjda mı, GPS kipi
export function insertBattery(t, lvl, chg, mode) { db().runSync('INSERT OR REPLACE INTO battery (t, lvl, chg, mode) VALUES (?, ?, ?, ?)', t, lvl, chg, mode || null); }
export function getBattery(a, b) { return db().getAllSync('SELECT t, lvl, chg, mode FROM battery WHERE t >= ? AND t < ? ORDER BY t', a, b); }

// Çevrimdışı harita karoları: anahtar "z/x/y", değer base64 PNG
export function getTile(k) { const r = db().getFirstSync('SELECT b FROM tile WHERE k = ?', k); return r ? r.b : null; }
export function hasTiles(keys) { const o = new Set(); for (const k of keys) if (db().getFirstSync('SELECT 1 AS x FROM tile WHERE k = ?', k)) o.add(k); return o; }
export function putTiles(rows) { const d = db(); d.withTransactionSync(() => { for (const [k, b] of rows) d.runSync('INSERT OR REPLACE INTO tile (k, b, at) VALUES (?, ?, ?)', k, b, Date.now()); }); }
export function tileStats() { const r = db().getFirstSync('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(b)), 0) AS bytes FROM tile'); return { n: r.n, mb: (r.bytes * 0.75) / 1048576 }; }
export function clearTiles() { db().execSync('DELETE FROM tile;'); }

export function wipeAll() { db().execSync('DELETE FROM points; DELETE FROM places; DELETE FROM overrides; DELETE FROM kv; DELETE FROM activity; DELETE FROM stat; DELETE FROM snap; DELETE FROM log; DELETE FROM battery;'); snapMem.clear(); }
