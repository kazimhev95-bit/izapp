// Sunucu aktarımı (yedek): telefondaki kayıtları — konum noktaları, hareket, pil, olay günlüğü ve yerler / tür
// düzeltmeleri / ayarlar — kendi sunucuna (server/sync/sync.js) aktarır.
//   * Telefon yine ÖNCE kendine yazar (internet yoksa kayıt kesilmez). Gönderilmemiş satır işaretli bekler
//     (store: sy IS NULL); sunucu kabul edince işaretlenir — bağlantı koparsa kaldığı yerden devam eder.
//   * Sıklık (kullanıcı kararı, 1 Eki 2026): Wi-Fi'de dakikada bir, mobil veride 10 dakikada bir. Hata olursa
//     1→2→4…30 dk bekleyip yeniden dener.
//   * Güvenlik: yalnız HTTPS; bu telefona özel kimlik + 256 bitlik gizli anahtar (iOS Anahtarlık'ta, "yalnız bu
//     cihaz", yedekle başka telefona geçmez). Sunucu anahtarın yalnız özetini tutar; satırları şifreli saklar.
//   * Süresiz saklanır; Ayarlar'dan «Sunucudaki verimi sil» ile silinir.
// tick() kalp atışından (tracker.js, 5 sn) ve konum görevinden çağrılır; süre dolmadıysa hemen döner (pil).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Network from 'expo-network';
import * as Crypto from 'expo-crypto';
import * as store from './store';
import { SNAP_HOST } from './snap';

const BASE = 'https://' + SNAP_HOST + '/v1/sync';
const KEY = process.env.EXPO_PUBLIC_IZ_KEY || ''; // uygulama anahtarı (derlemede verilir) — yeni cihaz kaydı için
const WIFI_MS = 60e3, CELL_MS = 10 * 60e3;
const BATCH = 1000;        // istek başına satır (konumda ~60 KB)
const BUDGET_MS = 25e3;    // bir turda en çok bu kadar gönder (arka planda iOS'un verdiği süreyi aşmayalım); kalan sonraki tura
const TIMEOUT_MS = 30e3;
const CRED = 'iz_sync_cred';
// Anahtarlık erişimi: telefon açılıştan sonra bir kez kilidi açılınca okunabilir — kilitli ekranda arka plan
// aktarımı da çalışsın diye. THIS_DEVICE_ONLY: iCloud/iTunes yedeğiyle başka cihaza taşınmaz.
const SS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const TABLES = ['p', 'a', 'b', 'l']; // önce konum (en değerlisi)

export const available = () => !!KEY;
export const enabled = () => !!KEY && store.getKV('sync', true); // varsayılan AÇIK (kullanıcı istedi)
export function setEnabled(on) {
  store.setKV('sync', !!on);
  store.addLog('ayar', 'sunucuya aktarım: ' + (on ? 'açık' : 'kapalı'));
  if (on) { failN = 0; nextTry = 0; lastRun = 0; }
}

// Ayarlar'da gösterilen durum: son başarılı aktarım, ağ, son turda giden satır, son hata
export const status = { at: null, net: null, sent: 0, err: null, busy: false };
try { status.at = store.getKV('sync_at', null); } catch (e) { /* yoksay */ }

let busy = false, lastRun = 0, nextTry = 0, failN = 0, nextNet = 0, credMem = null;
const errOf = (msg, wait) => Object.assign(new Error(msg), { wait });
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

// Ağ türü: 'wifi' | 'cell' | null (bağlantı yok). Bilinmeyen tür (VPN vb.) tutumlu tarafta: mobil sayılır.
async function netType() {
  try {
    const s = await Network.getNetworkStateAsync();
    if (!s.isConnected || s.isInternetReachable === false) return null;
    return s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET ? 'wifi' : 'cell';
  } catch (e) { return 'cell'; }
}

// Bu telefonun kimliği: Anahtarlık'ta yoksa üretilir (güvenli rastgele). Okuma HATA verirse (ör. telefon açıldı ama
// kilidi hiç açılmadı) yenisi ÜRETİLMEZ — yoksa sunucuda sahipsiz cihaz birikirdi; tur iptal, sonra denenir.
async function cred() {
  if (credMem) return credMem;
  let c = null;
  try { const s = await SecureStore.getItemAsync(CRED, SS); c = s ? JSON.parse(s) : null; } catch (e) { throw errOf('anahtarlık okunamadı'); }
  if (!c || !/^[0-9a-f]{32}$/.test(c.dev || '') || !/^[0-9a-f]{64}$/.test(c.sec || '')) {
    c = { dev: hex(Crypto.getRandomBytes(16)), sec: hex(Crypto.getRandomBytes(32)) };
    await SecureStore.setItemAsync(CRED, JSON.stringify(c), SS);
    store.setKV('sync_dev', null); // yeni kimlik: kaydolması gerek
  }
  return (credMem = c);
}

// Sunucuya istek. Kimlik başlığı: "Bearer <dev>.<sec>" (kayıtta yok).
async function call(path, c, body, withAuth = true) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const headers = { 'content-type': 'application/json', 'x-iz-key': KEY };
  if (withAuth) headers.authorization = 'Bearer ' + c.dev + '.' + c.sec;
  let res;
  try {
    res = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
  } catch (e) { throw errOf(e && e.name === 'AbortError' ? 'zaman aşımı' : 'bağlantı yok'); } finally { clearTimeout(tm); }
  let j = null;
  try { j = await res.json(); } catch (e) { /* boş cevap */ }
  if (res.ok) return j || {};
  const why = j && j.error;
  if (res.status === 401 && withAuth) { store.setKV('sync_dev', null); throw errOf('kimlik reddedildi — yeniden kaydolacak'); }
  if (res.status === 429) throw errOf(why === 'kota' ? 'günlük sınır doldu' : 'çok sık istek', 10 * 60e3);
  throw Object.assign(errOf('sunucu ' + res.status + (why ? ' (' + why + ')' : '')), { code: res.status, why });
}

// Yeni cihaz kaydı (bir kez). Sunucu en çok birkaç cihaz kabul eder; dolu / kapalı / iptal ise 6 saat sonra yeniden sorar.
async function register(c) {
  try {
    await call('/register', c, { dev: c.dev, sec: c.sec, info: Platform.OS + ' ' + Platform.Version }, false);
  } catch (e) {
    if (e.code === 409) { // bu kimlik sunucuda başka anahtarla kayıtlı (olmamalı): yeni kimlik üret
      await SecureStore.deleteItemAsync(CRED, SS).catch(() => {});
      credMem = null;
      throw errOf('kimlik çakıştı — yenisi üretilecek');
    }
    if (e.code === 403) throw errOf({ dolu: 'sunucu yeni cihaz kabul etmiyor (sınır dolu)', kapalı: 'sunucuda yeni kayıt kapalı', iptal: 'bu telefon sunucuda iptal edilmiş' }[e.why] || e.message, 6 * 3600e3);
    throw e;
  }
  store.setKV('sync_dev', c.dev);
  store.addLog('sunucu', 'aktarım: bu telefon sunucuya kaydedildi (' + c.dev.slice(0, 8) + ')');
}

// Satırı sunucu biçimine getir: koordinat 7 basamak (~1 cm), ölçümler 2 basamak, uzun günlük metni kırpılır
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const PACK = {
  p: (r) => [r[0], Math.round(r[1] * 1e7) / 1e7, Math.round(r[2] * 1e7) / 1e7, r2(r[3]), r2(r[4]), r2(r[5]), r2(r[6])],
  a: (r) => [r[0], r[1], r[2]],
  b: (r) => [r[0], r[1], r[2] ? 1 : 0, r[3] == null ? null : String(r[3])],
  l: (r) => [r[0], r[1], String(r[2]).slice(0, 40), r[3] == null ? null : String(r[3]).slice(0, 4000)],
};
// Kısa metin özeti (yerler/ayarlar değişti mi — değişmediyse yeniden gönderme)
function hashOf(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + ':' + s.length; }

// Bir aktarım turu
async function run(net) {
  const t0 = Date.now();
  let sent = 0;
  status.busy = true;
  try {
    const c = await cred();
    if (store.getKV('sync_dev', null) !== c.dev) await register(c);
    for (const tb of TABLES) {
      while (Date.now() - t0 < BUDGET_MS) {
        const rows = store.unsent(tb, BATCH);
        if (!rows.length) break;
        await call('/push', c, { tb, rows: rows.map(PACK[tb]) });
        store.markSent(tb, rows.map((r) => r[0]));
        sent += rows.length;
        if (rows.length < BATCH) break;
      }
    }
    const meta = store.syncMeta(), h = hashOf(JSON.stringify(meta));
    if (h !== store.getKV('sync_mh', null)) { await call('/meta', c, meta); store.setKV('sync_mh', h); }
    // Günlüğe yalnız ilk başarı / hatadan dönüş yazılır (her dakika satır yazıp günlüğü şişirmesin)
    if (failN || !status.at) store.addLog('sunucu', 'aktarım çalışıyor (' + (net === 'wifi' ? 'Wi-Fi' : 'mobil') + '): ' + sent + ' satır gitti');
    failN = 0; nextTry = 0;
    Object.assign(status, { at: Date.now(), net, sent, err: null });
    store.setKV('sync_at', status.at);
  } catch (e) {
    failN++;
    nextTry = Date.now() + (e.wait || Math.min(30 * 60e3, 60e3 * 2 ** Math.min(failN - 1, 5))); // 1, 2, 4, 8, 16, 30 dk
    status.err = String((e && e.message) || e);
    if (failN === 1) store.addLog('sunucu', 'aktarım HATA: ' + status.err + (sent ? ' (' + sent + ' satır gitmişti)' : ''));
  } finally { status.busy = false; }
}

// Kalp atışı / görev çağırır. Ağ türüne en çok dakikada bir bakılır; Wi-Fi'de 1 dk, mobilde 10 dk dolmadıysa döner.
// force: «Şimdi aktar» düğmesi (süre ve hata beklemesi yok sayılır; bağlantı yine gerekir).
export async function tick(force = false) {
  if (!enabled() || busy) return;
  const now = Date.now();
  if (!force && (now < nextTry || now < nextNet)) return;
  busy = true;
  try {
    nextNet = now + 55e3;
    const net = await netType();
    if (!net) { if (force) status.err = 'internet yok'; return; }
    if (!force && now - lastRun < (net === 'wifi' ? WIFI_MS : CELL_MS) - 5e3) return; // kalp atışı 5 sn oynar
    lastRun = now;
    await run(net);
  } finally { busy = false; }
}

// Bekleyen (gitmemiş) satır sayıları
export const pending = () => store.unsentCount();

// Sunucudaki satır sayıları {n:{p,a,b,l,m}, first, last}. Kayıtlı değilse sunucuda veri de yoktur.
export async function serverInfo() {
  if (!KEY) return null;
  const c = await cred();
  if (store.getKV('sync_dev', null) !== c.dev) return { n: {}, first: null, last: null };
  return call('/status', c, null);
}

// Sunucudaki verinin TAMAMINI sil (bu telefona ait olan). Telefondaki veri kalır; aktarım açıksa bundan sonraki
// yeni kayıtlar yine gider. Dönüş: silinen satır sayısı.
export async function wipeServer() {
  const c = await cred();
  if (store.getKV('sync_dev', null) !== c.dev) return 0;
  while (busy) await new Promise((r) => setTimeout(r, 300)); // süren tur bitsin (silmeden hemen sonra eski satır yazmasın)
  busy = true;
  try {
    const j = await call('/wipe', c, {});
    store.addLog('sunucu', 'sunucudaki veri silindi: ' + j.deleted + ' satır');
    return j.deleted || 0;
  } finally { busy = false; }
}

// Kimliğin kısa hali (Ayarlar'da gösterilir; gizli anahtar asla gösterilmez)
export const deviceId = () => { const d = store.getKV('sync_dev', null); return d ? d.slice(0, 8) : null; };
