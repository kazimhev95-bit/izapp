// Yola oturtma (map matching): bitmiş yolculuk parçalarının noktalarını KENDİ sunucumuza (VDS'teki OSRM)
// sorar; gelen yol çizgisini telefonda saklar (her parça bir kez sorulur). Sunucu hiçbir şeyi kaydetmez.
// Çizgi haritada gerçek izle birleştirilerek kullanılır (snapcore.js fuseSnap) — izden sapmaz.
// Sunucuya ulaşılamazsa uygulama eskisi gibi yerel düzeltmeyle çizer, 5 dk sonra yeniden dener.
import * as store from './store';
import { snapKey, snapCandidates, SNAP_MODES } from './snapcore';

export const SNAP_HOST = 'iz.80-240-17-26.sslip.io';
const URL_ = 'https://' + SNAP_HOST + '/v1/match';
const KEY = process.env.EXPO_PUBLIC_IZ_KEY || ''; // derlemede verilir (GitHub gizli değişkeni), depoda yok
const BATCH = 10;           // tek istekte en çok parça
const RETRY_MS = 5 * 60e3;  // hata sonrası bekleme

export const available = () => !!KEY;
export const enabled = () => !!KEY && store.getKV('snap', true);
export const setEnabled = (v) => store.setKV('snap', !!v);

// analyze() için: önbellekte başarılı sonuç varsa {parts}, yoksa null
export function lookup(leg) {
  if (!SNAP_MODES[leg.mode]) return null;
  const r = store.getSnap(snapKey(leg));
  return r && r.ok ? r : null;
}

let busy = false, nextTry = 0;
export const status = { at: null, err: null }; // son başarılı soru anı / son hata (Ayarlar'da gösterilir)

// Eksik parçaları sor ve sakla. Dönüş: yeni sonuç geldiyse true (analiz yenilensin).
export async function fill(items) {
  if (!enabled() || busy || Date.now() < nextTry) return false;
  const todo = snapCandidates(items, Date.now(), (k) => store.getSnap(k) != null);
  if (!todo.length) return false;
  busy = true;
  let got = 0;
  try {
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 30e3);
      let res;
      try {
        res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-iz-key': KEY }, body: JSON.stringify({ legs: part.map((x) => x.leg) }), signal: ctl.signal });
      } finally { clearTimeout(tm); }
      if (!res.ok) throw new Error('sunucu ' + res.status);
      const j = await res.json();
      // Oturmayan parça da saklanır (ok:false) — aynı veriyle yeniden sormak aynı cevabı verir.
      const rows = (j.legs || []).filter((r) => r && r.id).map((r) => [r.id, r.ok ? { ok: true, parts: r.parts } : { ok: false, why: r.why || '?' }]);
      store.setSnaps(rows);
      got += rows.length;
    }
    status.at = Date.now(); status.err = null;
    store.addLog('sunucu', 'yola oturtma: ' + todo.length + ' parça soruldu, ' + got + ' cevap');
  } catch (e) {
    status.err = e && e.name === 'AbortError' ? 'zaman aşımı' : String((e && e.message) || e);
    nextTry = Date.now() + RETRY_MS;
    store.addLog('sunucu', 'yola oturtma HATA: ' + status.err);
  } finally { busy = false; }
  return got > 0;
}

// ---- Otobüs durakları (OSM, kendi sunucumuzdan) ----
// Bir kez indirilir (~40 KB), 30 günde bir tazelenir; sonra çevrimdışı çalışır. Motor aracın durduğu yerlerin
// gerçek durağa denk gelip gelmediğine bakar: otobüs durakta durur, araba ışıkta/tıxacda rastgele yerde.
const CELL = 0.002; // ° (~200 m) ızgara hücresi
let stopIdx; // undefined: henüz yüklenmedi, null: liste yok
function loadIdx() {
  if (stopIdx !== undefined) return stopIdx;
  const s = store.getKV('busstops', null);
  if (!s || !s.pts) return (stopIdx = null);
  const g = new Map();
  for (const [la, lo] of s.pts) { const k = Math.floor(la / CELL) + ':' + Math.floor(lo / CELL); if (!g.has(k)) g.set(k, []); g.get(k).push([la, lo]); }
  return (stopIdx = g);
}
// En yakın otobüs durağına uzaklık (m); ~200 m'den uzaksa Infinity
function nearStop(lat, lon) {
  const g = stopIdx, gy = Math.floor(lat / CELL), gx = Math.floor(lon / CELL), k = Math.cos((lat * Math.PI) / 180);
  let m = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    for (const q of g.get(gy + dy + ':' + (gx + dx)) || []) { const d = Math.hypot((q[0] - lat) * 111320, (q[1] - lon) * 111320 * k); if (d < m) m = d; }
  }
  return m;
}
// analyze() için: liste varsa uzaklık fonksiyonu, yoksa null (o zaman durak ipucu kullanılmaz)
export const busNear = () => (loadIdx() ? nearStop : null);
// Listeyi indir (yoksa ya da 30 günden eskiyse). Dönüş: yeni liste geldiyse true (analiz yenilensin).
export async function fetchStops() {
  if (!KEY) return false;
  const s = store.getKV('busstops', null);
  if (s && Date.now() - (s.at || 0) < 30 * 86400e3) return false;
  try {
    const res = await fetch('https://' + SNAP_HOST + '/v1/busstops', { headers: { 'x-iz-key': KEY } });
    if (!res.ok) return false;
    const j = await res.json();
    if (!j || !Array.isArray(j.pts) || !j.pts.length) return false;
    store.setKV('busstops', { v: j.v, n: j.n, pts: j.pts, at: Date.now() });
    store.addLog('sunucu', 'otobüs durak listesi indi: ' + j.n + ' durak');
    stopIdx = undefined;
    return true;
  } catch (e) { return false; }
}
export const stopsInfo = () => { const s = store.getKV('busstops', null); return s ? { n: s.n, v: s.v } : null; };

// Önbelleği boşalt: tüm parçalar yeniden sorulur (sunucu kuralları iyileşince)
export function reset() { store.clearSnaps(); nextTry = 0; }
