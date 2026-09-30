// Yerel veri deposu (SQLite) — tüm konum verisi SADECE telefonda durur, hiçbir sunucuya gitmez.
// Web önizlemesi için eşdeğeri: store.web.js (aynı fonksiyon imzaları).
import * as SQLite from 'expo-sqlite';

let _db = null;
function db() {
  if (_db) return _db;
  _db = SQLite.openDatabaseSync('iz.db');
  // WAL: arka plan görevi yazarken arayüz okuyabilsin.
  _db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS points (t INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, acc REAL, spd REAL);
    CREATE TABLE IF NOT EXISTS places (id INTEGER PRIMARY KEY AUTOINCREMENT, lat REAL NOT NULL, lon REAL NOT NULL, name TEXT, kind TEXT, addr TEXT);
    CREATE TABLE IF NOT EXISTS overrides (t0 INTEGER PRIMARY KEY, mode TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  `);
  return _db;
}

// Arka plan görevinden çağrılır: aynı zaman damgası ikinci kez gelirse yok sayılır.
export function insertPoints(arr) {
  if (!arr.length) return;
  const d = db();
  d.withTransactionSync(() => {
    for (const p of arr) d.runSync('INSERT OR IGNORE INTO points (t, lat, lon, acc, spd) VALUES (?, ?, ?, ?, ?)', p.t, p.lat, p.lon, p.acc ?? null, p.spd ?? null);
  });
}
export function getPoints(a, b) { return db().getAllSync('SELECT t, lat, lon, acc, spd FROM points WHERE t >= ? AND t < ? ORDER BY t', a, b); }
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

export function wipeAll() { db().execSync('DELETE FROM points; DELETE FROM places; DELETE FROM overrides; DELETE FROM kv;'); }
