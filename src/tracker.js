// Konum kaydı. İki bağımsız kaynak aynı veritabanına yazar (aynı zaman damgası tekrar gelirse yok sayılır):
//   1) GÖREV  — expo-task-manager arka plan görevi (iOS uygulamayı uyandırabildiği tek yol)
//   2) İZLEYİCİ — watchPositionAsync; scripts/patch-native.js yaması sayesinde arka planda da sürer
// Görev (task) MODÜL YÜKLENİRKEN tanımlanmalı: iOS uygulamayı arka planda uyandırdığında arayüz
// açılmaz, yalnız bu dosya çalışır (index.js'te en başta import edilir).
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { insertPoints, getKV, setKV, bumpStat, getStats } from './store';

const TASK = 'iz-konum-kaydi';
const toPoint = (l) => ({
  t: Math.round(l.timestamp), lat: l.coords.latitude, lon: l.coords.longitude,
  acc: l.coords.accuracy, spd: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
});
const errText = (e) => String((e && e.message) || e).slice(0, 200);

// ---- Tanı ----
// note: tekil değer (son hata vb.). count: "<kaynak>-<uygulama durumu>" sayaçları — ör. task-background,
// watch-active, beat-background. Arka planda gerçekten ne çalıştığını bunlar gösterir.
function note(k, v) { try { setKV(k, v); } catch (e) { /* yoksay */ } }
const appSt = () => AppState.currentState || 'unknown';
function count(k, n = 1, st) { try { bumpStat(k + '-' + (st || appSt()), n, Date.now()); } catch (e) { /* yoksay */ } }

// Sınama modu (yalnız simülatör testi veritabanına yazar; normal kullanımda null):
//   'task' yalnız görev · 'watch' yalnız izleyici · 'both' ikisi
export const testMode = () => { try { return getKV('test_mode', null); } catch (e) { return null; } };

TaskManager.defineTask(TASK, async ({ data, error, executionInfo }) => {
  if (error) { note('d_taskErr', errText(error)); count('taskerr'); return; }
  if (!data || !data.locations) return;
  try {
    insertPoints(data.locations.map(toPoint));
    count('task', data.locations.length, executionInfo && executionInfo.appState);
  } catch (e) { note('d_taskErr', 'yazma: ' + errText(e)); }
});

// Kalp atışı: JS'in arka planda çalışıp çalışmadığını ölçer (5 sn'de bir). Uygulama durum geçişleri
// ve açılış sayısı da sayılır — arka planda öldürülüp yeniden açıldıysa 'launch' artar.
count('launch');
setInterval(() => count('beat'), 5000);
AppState.addEventListener('change', (s) => count('app', 1, s));

// Hassasiyet profilleri:
//  'birebir' GPS'in verebildiği en iyi doğruluk, her ~3 m'de nokta — yol haritaya aynen çizilir
//  'hassas'  her ~15 m — tür ayrımı için yeterli, pil daha az gider
//  'pil'     seyrek ve kaba
const PROFILES = {
  birebir: { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3 },
  hassas: { accuracy: Location.Accuracy.High, distanceInterval: 15 },
  pil: { accuracy: Location.Accuracy.Balanced, distanceInterval: 40 },
};

const taskStarted = () => Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);

// İzin + çalışma durumu. bg: 'Her Zaman' izni (uygulama kapalıyken de kayıt için gerekli).
export async function status() {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  // İzin yoksa (ör. «Bir Kez İzin Ver» seçilmiş ve süresi dolmuş) görev kayıtlı görünse bile iOS konum
  // vermez — bu durumda "çalışıyor" DEME.
  const on = (await taskStarted()) || (testMode() === 'watch' && getKV('rec', false));
  return { fg: fg.granted, bg: bg.granted, canAskBg: bg.canAskAgain, running: fg.granted && !!on };
}

// Kaydı başlatır. Önce "kullanırken", sonra "her zaman" izni istenir (iOS bu sırayı şart koşar).
// Hata olursa fırlatmaz: tanı kaydına yazar ve gerçek durumu döner.
export async function start(profile = 'birebir') {
  const mode = testMode();
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) { note('d_startErr', 'konum izni verilmedi'); return status(); }
    // Sınama modunda izin penceresi açılmaz (simülatörde kapatacak kimse yok).
    const bg = mode ? await Location.getBackgroundPermissionsAsync() : await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
    note('d_perm', fg.status + '/' + (fg.ios ? fg.ios.scope : '?') + ' bg:' + bg.status);
    if (await taskStarted()) await Location.stopLocationUpdatesAsync(TASK);
    if (mode !== 'watch') {
      await Location.startLocationUpdatesAsync(TASK, {
        ...(PROFILES[profile] || PROFILES.birebir),
        activityType: Location.ActivityType.Other,
        pausesUpdatesAutomatically: false, // iOS durunca kaydı kendi kesmesin; tekrar başlatmayabiliyor
        // "Her Zaman" izni yoksa arka planda çalışmanın tek yolu mavi gösterge çubuğudur.
        showsBackgroundLocationIndicator: mode === 'taskind' ? true : !bg.granted,
      });
    }
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
// Yerel yama sayesinde bu izleyici uygulama arka plandayken de konum alır. Aboneliği kapatan
// fonksiyonu döner.
export function watch(cb, record) {
  let sub = null, dead = false, lastRec = null;
  Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 1000 }, (l) => {
    count('watch');
    cb({ lat: l.coords.latitude, lon: l.coords.longitude, acc: l.coords.accuracy, spd: toPoint(l).spd, t: Math.round(l.timestamp) });
    // Yerinde dururken saniyede bir nokta yazmamak için: yalnız ~2 m'den fazla yer değiştirince kaydet.
    const moved = !lastRec || Math.hypot((l.coords.latitude - lastRec.lat) * 111000, (l.coords.longitude - lastRec.lon) * 85000) >= 2;
    if (record && moved) {
      lastRec = { lat: l.coords.latitude, lon: l.coords.longitude };
      try { insertPoints([toPoint(l)]); count('watchrec'); } catch (e) { note('d_watchErr', 'yazma: ' + errText(e)); }
    }
  }, (reason) => note('d_watchErr', 'akış: ' + errText(reason)))
    .then((x) => { note('d_watchErr', null); if (dead) x.remove(); else sub = x; })
    .catch((e) => note('d_watchErr', errText(e)));
  return () => { dead = true; if (sub) sub.remove(); };
}

// Tanı: kayıt neden çalışmıyor sorusunu telefonda yanıtlamak için ham durum.
// test=true ise ayrıca o an tek bir konum istenir (en çok 12 sn beklenir).
export async function diag(test) {
  const out = {};
  const safe = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = 'HATA: ' + errText(e); } };
  await safe('services', () => Location.hasServicesEnabledAsync());
  await safe('fg', async () => { const p = await Location.getForegroundPermissionsAsync(); return p.status + (p.ios ? ' / ' + p.ios.scope : ''); });
  await safe('bg', async () => (await Location.getBackgroundPermissionsAsync()).status);
  await safe('registered', () => TaskManager.isTaskRegisteredAsync(TASK));
  await safe('started', () => taskStarted());
  for (const k of ['d_startAt', 'd_startErr', 'd_taskErr', 'd_watchErr']) out[k] = getKV(k, null);
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
