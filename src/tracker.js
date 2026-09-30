// Konum kaydı.
//   GÖREV    — expo-task-manager arka plan görevi: uygulama arkadayken / telefon kilitliyken kaydeder.
//   İZLEYİCİ — watchPositionAsync: harita ekrandayken canlı konum (mavi nokta, hız) verir; o da kaydeder.
// İkisi aynı veritabanına yazar; aynı/eski zaman damgalı nokta ikinci kez yazılmaz.
//
// ÖNEMLİ — arka planda kaydın ölmemesi için (iOS simülatöründe sistem günlüğüyle doğrulandı):
//  1) showsBackgroundLocationIndicator = true olmalı. iOS uygulamayı ancak o zaman arka planda "kullanımda"
//     sayıp çalışır tutuyor (durum çubuğunda mavi konum göstergesi). Kapalıyken — «Her Zaman» izni olsa
//     bile — uygulama arka plana geçtikten ~10–60 sn sonra askıya alınıyor ve kayıt duruyor.
//  2) iOS 16.4+ kuralı: yöneticide MESAFE SÜZGECİ OLMAMALI ve doğruluk 100 m ya da daha iyi olmalı.
//     Bu yüzden mesafe süzgeci iOS'a verilmez; "en az X metre yer değiştirdiyse sakla" eleği JS'te (keep).
//
// Görev (task) MODÜL YÜKLENİRKEN tanımlanmalı: iOS uygulamayı arka planda uyandırdığında arayüz
// açılmaz, yalnız bu dosya çalışır (index.js'te en başta import edilir).
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { insertPoints, insertActivity, getKV, setKV, bumpStat, getStats } from './store';

const TASK = 'iz-konum-kaydi';
const KEEPALIVE_MS = 5 * 60e3; // yerinde dururken de en az bu sıklıkta bir nokta sakla ("kayıt yaşıyor" izi)
const toPoint = (l) => ({
  t: Math.round(l.timestamp), lat: l.coords.latitude, lon: l.coords.longitude, acc: l.coords.accuracy,
  spd: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,        // m/s (GPS Doppler hızı)
  crs: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null,  // derece (gidiş yönü)
});
const errText = (e) => String((e && e.message) || e).slice(0, 200);

// ---- Tanı ----
// note: tekil değer (son hata vb.). count: "<kaynak>-<uygulama durumu>" sayaçları — ör. task-background,
// watch-active, beat-background. Arka planda gerçekten ne çalıştığını bunlar gösterir.
function note(k, v) { try { setKV(k, v); } catch (e) { /* yoksay */ } }
const appSt = () => AppState.currentState || 'unknown';
function count(k, n = 1, st) { try { bumpStat(k + '-' + (st || appSt()), n, Date.now()); } catch (e) { /* yoksay */ } }

// Sınama modu (yalnız simülatör testi veritabanına yazar; normal kullanımda null). Sınamada izleyici
// çalışmaz, izin penceresi açılmaz:
//   'task'      üretimdeki görev ayarı
//   'taskdf'    + mesafe süzgeci (eski ayar; karşılaştırma için)
//   'tasknoind' mavi gösterge kapalı (yalnız "süzgeçsiz" kuralı yetiyor mu?)
export const testMode = () => { try { return getKV('test_mode', null); } catch (e) { return null; } };

// Hassasiyet profilleri. minDist: bir önceki saklanan noktadan en az bu kadar uzaklaşınca yeni nokta saklanır.
//  'birebir' GPS'in en iyi doğruluğu, ~3 m'de bir nokta — yol haritaya aynen çizilir
//  'hassas'  ~12 m'de bir nokta — tür ayrımı için yeterli, daha az veri
//  'pil'     kaba konum (GPS yerine çoğunlukla Wi-Fi/baz), ~30 m'de bir nokta
const PROFILES = {
  birebir: { accuracy: Location.Accuracy.Highest, minDist: 3 },
  hassas: { accuracy: Location.Accuracy.High, minDist: 12 },
  pil: { accuracy: Location.Accuracy.Balanced, minDist: 30 },
};
const prof = (name) => PROFILES[name] || PROFILES.birebir;

// ---- Saklama eleği (görev ve izleyici ortak kullanır) ----
let lastKept = null;      // en son saklanan nokta
let minDist = prof(getKV('profile', 'birebir')).minDist;
const dist = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
// Gelen konumlardan saklanacakları seçip veritabanına yazar. Dönüş: saklanan nokta sayısı.
function keep(locations) {
  const out = [];
  for (const l of locations) {
    const p = toPoint(l);
    if (lastKept && p.t <= lastKept.t) continue; // eski ya da diğer kaynaktan zaten gelmiş
    // Gereken yer değiştirme: profilin mesafesi; konum kabaysa (bina içi, kısık kip) doğruluğun ~%40'ı —
    // yoksa yerinde dururken GPS'in sağa sola oynaması binlerce gereksiz nokta üretir.
    const need = Math.max(minDist, (p.acc || 0) * 0.4);
    if (!lastKept || dist(lastKept, p) >= need || p.t - lastKept.t >= KEEPALIVE_MS) { out.push(p); lastKept = p; }
  }
  if (out.length) insertPoints(out);
  return out.length;
}

// ---- Akıllı pil tasarrufu ----
// GPS'i en yüksek doğrulukta sürekli açık tutmak pili hızla bitirir; oysa günün çoğu bir yerde durarak geçer.
// Kural: STILL_MS boyunca yerinden kıpırdamadıysan konum doğruluğu "kaba"ya (100 m; GPS kapanır, Wi-Fi/baz
// kullanılır) indirilir. Yer değiştirdiğin an (WAKE_R metre kayma, hız, ya da hareket işlemcisi
// "yürüyor/araçta" derse) yeniden en yüksek doğruluğa çıkılır. Kayıt hiç durmaz; yalnız doğruluk değişir.
const STILL_R = 25, WAKE_R = 60, WAKE_V = 1.5;
const stillMs = () => (getKV('test_still', 0) || 180) * 1000; // 3 dk (sınamada kısaltılabilir)
let power = 'high', anchor = null, stillSince = 0, curProfile = getKV('profile', 'birebir');
// Varsayılan KAPALI: önce eksiksiz kayıt. Ayarlar'dan açılır.
const smartOn = () => getKV('smart', false) && curProfile !== 'pil';

// Görev seçenekleri. lowPower: kaba doğruluk (durağan mod).
function taskOptions(lowPower) {
  return {
    accuracy: lowPower ? Location.Accuracy.Balanced : prof(curProfile).accuracy,
    // distanceInterval BİLEREK verilmiyor (yukarıdaki iOS 16.4 kuralı): süzgeç JS'te (keep).
    activityType: Location.ActivityType.Other,
    pausesUpdatesAutomatically: false, // iOS durunca kaydı kendi kesmesin; tekrar başlatmayabiliyor
    showsBackgroundLocationIndicator: true, // ŞART: yoksa iOS arka planda askıya alır (baştaki not)
    // Arka planda konumları 5 sn'lik demetler halinde teslim et: JS saniyede bir uyanmasın (pil).
    deferredUpdatesInterval: 5000,
  };
}
// Doğruluk kipini değiştir. Görev zaten kayıtlıyken startLocationUpdatesAsync yalnız seçenekleri günceller
// (kayıt kesilmez).
async function setPower(p) {
  if (p === power) return;
  power = p; count('power' + p);
  try { if (await taskStarted()) await Location.startLocationUpdatesAsync(TASK, taskOptions(p === 'low')); } catch (e) { note('d_startErr', 'güç: ' + errText(e)); }
}
let lastLocAt = 0; // iOS'tan en son konum gelen an (cihaz saati)
function adapt(locations) {
  lastLocAt = Date.now();
  if (!smartOn()) { if (power === 'low') setPower('high'); return; }
  for (const l of locations) {
    const p = toPoint(l);
    if (power === 'high') {
      const still = anchor && (p.spd == null || p.spd < 0.5) && dist(anchor, p) <= STILL_R;
      if (!still) { anchor = p; stillSince = p.t; } else if (p.t - stillSince >= stillMs()) setPower('low');
    } else if ((p.spd != null && p.spd > WAKE_V) || (anchor && dist(anchor, p) > Math.max(WAKE_R, (p.acc || 0) * 1.2))) {
      anchor = p; stillSince = p.t; setPower('high');
    }
  }
}

TaskManager.defineTask(TASK, async ({ data, error, executionInfo }) => {
  if (error) {
    // kCLError 0 = "konum şu an bilinmiyor": geçicidir, iOS denemeyi sürdürür — hata diye gösterme.
    if (error.code !== 0) note('d_taskErr', errText(error));
    count('taskerr'); return;
  }
  if (!data || !data.locations) return;
  const st = executionInfo && executionInfo.appState;
  try {
    count('taskin', data.locations.length, st);  // iOS'tan gelen konum sayısı
    count('task', keep(data.locations), st);      // bunlardan saklanan
    adapt(data.locations);
  } catch (e) { note('d_taskErr', 'yazma: ' + errText(e)); }
});

// Kalp atışı: JS'in arka planda çalışıp çalışmadığını ölçer (5 sn'de bir). Uygulama durum geçişleri
// ve açılış sayısı da sayılır — arka planda öldürülüp yeniden açıldıysa 'launch' artar.
count('launch');
setInterval(() => {
  count('beat');
  // Hiç kıpırdamayınca iOS konum göndermeyebilir (adapt çağrılmaz): o zaman da durgun sayıp GPS'i kıs.
  if (smartOn() && power === 'high' && lastLocAt && Date.now() - lastLocAt >= stillMs()) setPower('low');
}, 5000);
AppState.addEventListener('change', (s) => count('app', 1, s));

const taskStarted = () => Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);

// İzin + çalışma durumu. bg: 'Her Zaman' izni.
export async function status() {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  // İzin yoksa (ör. «Bir Kez İzin Ver» seçilmiş ve süresi dolmuş) görev kayıtlı görünse bile iOS konum
  // vermez — bu durumda "çalışıyor" DEME.
  return { fg: fg.granted, bg: bg.granted, canAskBg: bg.canAskAgain, running: fg.granted && (await taskStarted()) };
}

// Kaydı başlatır. Önce "kullanırken", sonra "her zaman" izni istenir (iOS bu sırayı şart koşar).
// Hata olursa fırlatmaz: tanı kaydına yazar ve gerçek durumu döner.
export async function start(profile = 'birebir') {
  const mode = testMode(), P = prof(profile);
  minDist = P.minDist; curProfile = profile; power = 'high'; anchor = null;
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) { note('d_startErr', 'konum izni verilmedi'); return status(); }
    // Sınama modunda izin penceresi açılmaz (simülatörde kapatacak kimse yok).
    const bg = mode ? await Location.getBackgroundPermissionsAsync() : await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
    note('d_perm', fg.status + '/' + (fg.ios ? fg.ios.scope : '?') + ' bg:' + bg.status);
    if (await taskStarted()) await Location.stopLocationUpdatesAsync(TASK);
    const opt = taskOptions(false);
    if (mode === 'taskdf') opt.distanceInterval = 3;
    if (mode === 'tasknoind') opt.showsBackgroundLocationIndicator = false;
    await Location.startLocationUpdatesAsync(TASK, opt);
    note('d_startErr', null); note('d_startAt', Date.now());
  } catch (e) { note('d_startErr', errText(e)); }
  return status();
}

export async function stop() {
  try {
    if (await taskStarted()) await Location.stopLocationUpdatesAsync(TASK);
  } catch (e) { note('d_startErr', 'durdurma: ' + errText(e)); }
  return status();
}

// Canlı konum (haritadaki mavi nokta + hız). record=true ise noktalar veritabanına da yazılır.
// Aboneliği kapatan fonksiyonu döner.
export function watch(cb, record, profile = 'birebir') {
  let sub = null, dead = false;
  Location.watchPositionAsync({ accuracy: prof(profile).accuracy }, (l) => {
    count('watch');
    cb({ lat: l.coords.latitude, lon: l.coords.longitude, acc: l.coords.accuracy, spd: toPoint(l).spd, t: Math.round(l.timestamp) });
    if (record) { try { const n = keep([l]); if (n) count('watchrec', n); } catch (e) { note('d_watchErr', 'yazma: ' + errText(e)); } }
  }, (reason) => note('d_watchErr', 'akış: ' + errText(reason)))
    .then((x) => { note('d_watchErr', null); if (dead) x.remove(); else sub = x; })
    .catch((e) => note('d_watchErr', errText(e)));
  return () => { dead = true; if (sub) sub.remove(); };
}

// ---- Hareket kaydı (telefonun hareket işlemcisi: araçta / bisiklet / koşu / yürüyüş / duruyor) ----
// Tür ayrımında hızdan daha güvenilir: trafikte sürünen araba "yürüyüş" sanılmaz, koşu "araç" sanılmaz.
const ACT_KEYS = [['automotive', 'A'], ['cycling', 'C'], ['running', 'R'], ['walking', 'W'], ['stationary', 'S']];
let actSub = null, actTimer = null, lastAct = null, lastActTick = 0;
function onActivity(a) {
  let k = 'U', c = 0;
  for (const [name, code] of ACT_KEYS) { const e = a.activities && a.activities[name]; if (e && e.detected) { k = code; c = e.confidence; break; } }
  lastAct = { k, c };
  if (power === 'low' && c >= 1 && k !== 'S' && k !== 'U') setPower('high'); // kıpırdadı: GPS'i hemen aç
  try { insertActivity(Math.round(a.timestamp || Date.now()), k, c); count('act'); } catch (e) { /* yoksay */ }
}
// Dinlemeye başlar (ilk seferde iOS "Hareket ve Fitness" iznini sorar). İzin verilmezse tür ayrımı
// yalnız hızla yapılır — kayıt yine çalışır.
export async function startActivity() {
  if (actSub) return true;
  try {
    const p = await Location.requestMotionActivityPermissionsAsync();
    if (!p.granted) { note('d_actErr', 'hareket izni yok (' + p.status + ')'); return false; }
    actSub = await Location.watchMotionActivityAsync(onActivity, (r) => note('d_actErr', errText(r)));
    // iOS yalnız DEĞİŞİNCE haber verir; uzun süren aynı durumu (ör. 40 dk araba) dakikada bir yeniden
    // yazarız ki "eski kayıt" sayılıp geçersizleşmesin. Uygulama askıdan döndüyse eski durumu kullanma.
    lastActTick = Date.now();
    actTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastActTick > 150e3) lastAct = null;
      lastActTick = now;
      if (lastAct) { try { insertActivity(now, lastAct.k, lastAct.c); } catch (e) { /* yoksay */ } }
    }, 60e3);
    note('d_actErr', null);
    return true;
  } catch (e) { note('d_actErr', errText(e)); return false; }
}
export function stopActivity() {
  if (actSub) { actSub.remove(); actSub = null; }
  if (actTimer) { clearInterval(actTimer); actTimer = null; }
  lastAct = null;
}

// Tanı: kayıt neden çalışmıyor sorusunu telefonda yanıtlamak için ham durum.
// test=true ise ayrıca o an tek bir konum istenir (en çok 12 sn beklenir).
export async function diag(test) {
  const out = {};
  const safe = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = 'HATA: ' + errText(e); } };
  await safe('services', () => Location.hasServicesEnabledAsync());
  await safe('fg', async () => { const p = await Location.getForegroundPermissionsAsync(); return p.status + (p.ios ? ' / ' + p.ios.scope : ''); });
  await safe('bg', async () => (await Location.getBackgroundPermissionsAsync()).status);
  await safe('motion', async () => (await Location.getMotionActivityPermissionsAsync()).status);
  await safe('registered', () => TaskManager.isTaskRegisteredAsync(TASK));
  for (const k of ['d_startAt', 'd_startErr', 'd_taskErr', 'd_watchErr', 'd_actErr']) out[k] = getKV(k, null);
  out.power = power;
  out.stats = getStats();
  if (test) {
    await safe('test', async () => {
      const l = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('12 sn içinde konum gelmedi')), 12000)),
      ]);
      return l.coords.latitude.toFixed(5) + ', ' + l.coords.longitude.toFixed(5) + ' ±' + Math.round(l.coords.accuracy) + ' m';
    });
  }
  return out;
}

// Koordinat -> kısa adres (iOS'un kendi servisi; ücretsiz, anahtar gerekmez).
export async function geocode(lat, lon) {
  try {
    const r = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }))[0];
    if (!r) return null;
    return r.name || r.street || r.district || r.city || null;
  } catch (e) { return null; }
}

// Akıllı pil tasarrufunu aç/kapat (Ayarlar).
export function setSmart(on) { setKV('smart', !!on); if (!on) setPower('high'); }
