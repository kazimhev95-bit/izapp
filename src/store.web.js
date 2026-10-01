// Web önizlemesi için bellek içi depo (SQLite yerine). İmzalar store.js ile birebir aynıdır.
// Önizleme klasöründe veri.json varsa (telefondan dışa aktarılan GERÇEK kayıt) onu yükler; yoksa
// sentetik demo veriyle dolar. (veri.json: node scripts/csv2json.js veri/iz-veri-*.csv dist/veri.json)
import { demoData } from './demo';

function loadReal() {
  try {
    const x = new XMLHttpRequest();
    x.open('GET', './veri.json', false); // eşzamanlı: depo modül yüklenirken hazır olsun
    x.send();
    if (x.status === 200) { const j = JSON.parse(x.responseText); if (j && j.points && j.points.length) return j; }
  } catch (e) { /* yoksa demo */ }
  return null;
}
const D = loadReal() || demoData(Date.now(), 21);
let points = D.points, acts = D.acts || [];
let places = [], nextId = 1, overrides = {}, kv = {};

export function insertPoints(arr) { points = points.concat(arr).sort((a, b) => a.t - b.t); }
export function getPoints(a, b, step = 0) {
  const r = points.filter((p) => p.t >= a && p.t < b);
  if (!step) return r;
  let last = -1; // her step'lik dilimden ilk nokta (store.js ile aynı davranış)
  return r.filter((p) => { const k = Math.floor(p.t / step); if (k === last) return false; last = k; return true; });
}
export function rangeVersion(a, b) { const r = getPoints(a, b); return r.length + ':' + (r.length ? r[r.length - 1].t : 0); }
export function pointStats() { return { n: points.length, first: points[0]?.t ?? null, last: points[points.length - 1]?.t ?? null }; }

export function getPlaces() { return places.map((p) => ({ ...p })); }
export function addPlace(pl) { const id = nextId++; places.push({ id, lat: pl.lat, lon: pl.lon, name: pl.name ?? null, kind: pl.kind ?? null, addr: pl.addr ?? null }); return id; }
export function updatePlace(id, name, kind) { const p = places.find((x) => x.id === id); if (p) { p.name = name || null; p.kind = kind || null; } }

export function getOverrides() { return { ...overrides }; }
export function setOverride(t0, mode) { if (mode) overrides[t0] = mode; else delete overrides[t0]; }

export function getKV(k, def = null) { return k in kv ? kv[k] : def; }
export function setKV(k, v) { kv[k] = v; }

export function insertActivity(t, k, c) { acts.push({ t, k, c }); }
export function getActivity(a, b) { return acts.filter((x) => x.t >= a && x.t < b); }
export function bumpStat() {}
export function getStats() { return {}; }

// Olay günlüğü (bellekte)
let logs = [];
export function addLog(k, v) { logs.push({ t: Date.now(), k, v: v == null ? null : typeof v === 'string' ? v : JSON.stringify(v) }); }
export function getLogs(a, b, limit = 100000) { return logs.filter((x) => x.t >= a && x.t < b).reverse().slice(0, limit); }
export function logCount() { return logs.length; }

// Yola oturtma önbelleği (bellekte)
const snaps = new Map();
export function getSnap(k) { return snaps.get(k) || null; }
export function setSnaps(rows) { for (const [k, v] of rows) snaps.set(k, v); }
export function snapStats() { let ok = 0; for (const v of snaps.values()) if (v.ok) ok++; return { ok, fail: snaps.size - ok }; }
export function clearSnaps() { snaps.clear(); }

export function wipeAll() { acts = []; points = []; places = []; overrides = {}; kv = {}; snaps.clear(); logs = []; }
