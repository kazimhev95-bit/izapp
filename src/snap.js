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
  } catch (e) {
    status.err = e && e.name === 'AbortError' ? 'zaman aşımı' : String((e && e.message) || e);
    nextTry = Date.now() + RETRY_MS;
  } finally { busy = false; }
  return got > 0;
}

// Önbelleği boşalt: tüm parçalar yeniden sorulur (sunucu kuralları iyileşince)
export function reset() { store.clearSnaps(); nextTry = 0; }
