// Çevrimdışı harita: kayıtlı yolculukların geçtiği bölgenin karoları telefona indirilir (SQLite `tile` tablosu);
// harita sayfası karoyu önce buradan ister, yoksa ağdan yükler. Şehir dışında / metroda / internetsizken
// harita yine açılır. Zoom 11-16: şehir görünümünden sokak görünümüne; 17+ ağdan (çok büyür).
// Karo sunucusu OSM'nin genel sunucusu — kibar davran: aynı anda 2 istek, istek başına ~100 ms ara.
import { addLog, hasTiles, putTiles, tileStats, clearTiles } from './store';

export const ZOOMS = [11, 12, 13, 14, 15, 16];
export const PAD = 0.004;   // ° — yolculuk kutusunun etrafına pay (~400 m)
export const MAX_TILES = 6000; // güvenlik: bir seferde en çok bu kadar karo (≈ 60-90 MB)
// İndirilmiş karo varsa her zaman kullanılır (ayrı bir anahtar yok: indirdiysen kullanmak istiyorsundur)
export const offlineOn = () => true;

// enlem/boylam → karo numarası
function tileOf(lat, lon, z) {
  const n = 2 ** z, x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
}
// Noktaların kapladığı kutular (bir gün birden çok ayrı bölge olabilir; yakın noktalar tek kutuda)
export function boxesOf(points) {
  const boxes = [];
  for (const p of points) {
    let b = boxes.find((x) => p.lat >= x.s - 0.02 && p.lat <= x.n + 0.02 && p.lon >= x.w - 0.02 && p.lon <= x.e + 0.02);
    if (!b) { b = { s: p.lat, n: p.lat, w: p.lon, e: p.lon }; boxes.push(b); }
    b.s = Math.min(b.s, p.lat); b.n = Math.max(b.n, p.lat); b.w = Math.min(b.w, p.lon); b.e = Math.max(b.e, p.lon);
  }
  return boxes;
}
// Kutuların karo anahtarları ("z/x/y")
export function keysOf(boxes) {
  const keys = new Set();
  for (const b of boxes) for (const z of ZOOMS) {
    const [x0, y0] = tileOf(b.n + PAD, b.w - PAD, z), [x1, y1] = tileOf(b.s - PAD, b.e + PAD, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.add(z + '/' + x + '/' + y);
  }
  return [...keys];
}

// base64: Hermes'in btoa'sı (RN 0.73+); yoksa elle (tek yere bağlı kalmasın)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(buf) {
  if (typeof btoa === 'function') { let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192)); return btoa(s); }
  let o = '';
  for (let i = 0; i < buf.length; i += 3) {
    const a = buf[i], b = i + 1 < buf.length ? buf[i + 1] : 0, c = i + 2 < buf.length ? buf[i + 2] : 0, n = (a << 16) | (b << 8) | c;
    o += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < buf.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < buf.length ? B64[n & 63] : '=');
  }
  return o;
}

// İndirme: eksik karoları çeker. onProgress(done, total). Dönüş: {total, got, fail}
let busy = false;
export const downloading = () => busy;
export async function download(points, onProgress) {
  if (busy) return null;
  busy = true;
  try {
    const all = keysOf(boxesOf(points));
    if (all.length > MAX_TILES) { addLog('çevrimdışı', 'çok karo: ' + all.length + ' (sınır ' + MAX_TILES + ')'); return { total: all.length, got: 0, fail: 0, tooMany: true }; }
    const have = hasTiles(all), todo = all.filter((k) => !have.has(k));
    let done = 0, fail = 0, batch = [];
    const one = async (k) => {
      try {
        const res = await fetch('https://tile.openstreetmap.org/' + k + '.png', { headers: { 'User-Agent': 'IZ-konum-gunlugu/1.0 (kisisel, cevrimdisi onbellek)' } });
        if (!res.ok) throw new Error(String(res.status));
        batch.push([k, toB64(new Uint8Array(await res.arrayBuffer()))]);
      } catch (e) { fail++; }
      done++;
      if (batch.length >= 20) { putTiles(batch); batch = []; }
      if (onProgress && done % 10 === 0) onProgress(done, todo.length);
    };
    for (let i = 0; i < todo.length; i += 2) {
      await Promise.all(todo.slice(i, i + 2).map(one));
      await new Promise((r) => setTimeout(r, 100));
    }
    if (batch.length) putTiles(batch);
    addLog('çevrimdışı', 'karo indirildi: ' + (done - fail) + '/' + todo.length + ' (toplam ' + all.length + ', hata ' + fail + ')');
    return { total: all.length, got: done - fail, fail };
  } finally { busy = false; }
}
export { tileStats, clearTiles };
