// Web önizlemesi için bellek içi depo (SQLite yerine) — sentetik demo veriyle dolu gelir.
// İmzalar store.js ile birebir aynıdır.
import { demoPoints } from './demo';

let points = demoPoints(Date.now(), 21);
let places = [], nextId = 1, overrides = {}, kv = {};

export function insertPoints(arr) { points = points.concat(arr).sort((a, b) => a.t - b.t); }
export function getPoints(a, b, step = 0) {
  const r = points.filter((p) => p.t >= a && p.t < b);
  if (!step) return r;
  let last = -1; // her step'lik dilimden ilk nokta (store.js ile aynı davranış)
  return r.filter((p) => { const k = Math.floor(p.t / step); if (k === last) return false; last = k; return true; });
}
export function pointStats() { return { n: points.length, first: points[0]?.t ?? null, last: points[points.length - 1]?.t ?? null }; }

export function getPlaces() { return places.map((p) => ({ ...p })); }
export function addPlace(pl) { const id = nextId++; places.push({ id, lat: pl.lat, lon: pl.lon, name: pl.name ?? null, kind: pl.kind ?? null, addr: pl.addr ?? null }); return id; }
export function updatePlace(id, name, kind) { const p = places.find((x) => x.id === id); if (p) { p.name = name || null; p.kind = kind || null; } }

export function getOverrides() { return { ...overrides }; }
export function setOverride(t0, mode) { if (mode) overrides[t0] = mode; else delete overrides[t0]; }

export function getKV(k, def = null) { return k in kv ? kv[k] : def; }
export function setKV(k, v) { kv[k] = v; }

export function wipeAll() { points = []; places = []; overrides = {}; kv = {}; }
