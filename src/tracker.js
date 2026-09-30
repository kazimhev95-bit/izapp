// Arka plan konum kaydı. Görev (task) MODÜL YÜKLENİRKEN tanımlanmalı: iOS uygulamayı arka planda
// uyandırdığında arayüz açılmaz, yalnız bu dosya çalışır (index.js'te en başta import edilir).
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { insertPoints, getKV, setKV } from './store';

const TASK = 'iz-konum-kaydi';
const toPoint = (l) => ({
  t: Math.round(l.timestamp), lat: l.coords.latitude, lon: l.coords.longitude,
  acc: l.coords.accuracy, spd: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
});
const errText = (e) => String((e && e.message) || e).slice(0, 200);

// Tanı kayıtları (Ayarlar → Tanı): görev en son ne zaman çağrıldı, kaç kez, son hata ne?
function note(k, v) { try { setKV(k, v); } catch (e) { /* yoksay */ } }

TaskManager.defineTask(TASK, async ({ data, error }) => {
  note('d_taskLast', Date.now());
  if (error) { note('d_taskErr', errText(error)); return; }
  if (!data || !data.locations) return;
  try {
    insertPoints(data.locations.map(toPoint));
    note('d_taskN', (getKV('d_taskN', 0) || 0) + data.locations.length);
  } catch (e) { note('d_taskErr', 'yazma: ' + errText(e)); }
});

// Hassasiyet profilleri:
//  'birebir' GPS'in verebildiği en iyi doğruluk, her ~3 m'de nokta — yol haritaya aynen çizilir
//  'hassas'  her ~15 m — tür ayrımı için yeterli, pil daha az gider
//  'pil'     seyrek ve kaba
const PROFILES = {
  birebir: { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3 },
  hassas: { accuracy: Location.Accuracy.High, distanceInterval: 15 },
  pil: { accuracy: Location.Accuracy.Balanced, distanceInterval: 40 },
};

// İzin + çalışma durumu. bg: 'Her Zaman' izni (uygulama kapalıyken de kayıt için gerekli).
export async function status() {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  // İzin yoksa (ör. «Bir Kez İzin Ver» seçilmiş ve süresi dolmuş) görev kayıtlı görünse bile iOS konum
  // vermez — bu durumda "çalışıyor" DEME.
  const running = fg.granted && (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false));
  return { fg: fg.granted, bg: bg.granted, canAskBg: bg.canAskAgain, running };
}

// Kaydı başlatır. Önce "kullanırken", sonra "her zaman" izni istenir (iOS bu sırayı şart koşar).
// Hata olursa fırlatmaz: tanı kaydına yazar ve gerçek durumu döner.
export async function start(profile = 'birebir') {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) { note('d_startErr', 'konum izni verilmedi'); return status(); }
    const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
    if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(TASK);
    await Location.startLocationUpdatesAsync(TASK, {
      ...(PROFILES[profile] || PROFILES.birebir),
      activityType: Location.ActivityType.Other,
      pausesUpdatesAutomatically: false, // iOS durunca kaydı kendi kesmesin; tekrar başlatmayabiliyor
      // "Her Zaman" izni yoksa arka planda çalışmanın tek yolu mavi gösterge çubuğudur.
      showsBackgroundLocationIndicator: !bg.granted,
    });
    note('d_startErr', null); note('d_startAt', Date.now());
  } catch (e) { note('d_startErr', errText(e)); }
  return status();
}

export async function stop() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(TASK);
  } catch (e) { note('d_startErr', 'durdurma: ' + errText(e)); }
  return status();
}

// Ekran açıkken canlı konum (haritadaki mavi nokta + hız). record=true ise noktalar veritabanına da
// yazılır: arka plan görevi herhangi bir nedenle nokta vermese bile uygulama açıkken iz kaydolur
// (aynı zaman damgası iki kez gelirse depo yok sayar). Aboneliği kapatan fonksiyonu döner.
export function watch(cb, record) {
  let sub = null, dead = false, lastRec = null;
  Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 1000 }, (l) => {
    note('d_watchLast', Date.now());
    cb({ lat: l.coords.latitude, lon: l.coords.longitude, acc: l.coords.accuracy, spd: toPoint(l).spd, t: Math.round(l.timestamp) });
    // Yerinde dururken saniyede bir nokta yazmamak için: yalnız ~2 m'den fazla yer değiştirince kaydet.
    const moved = !lastRec || Math.hypot((l.coords.latitude - lastRec.lat) * 111000, (l.coords.longitude - lastRec.lon) * 85000) >= 2;
    if (record && moved) {
      lastRec = { lat: l.coords.latitude, lon: l.coords.longitude };
      try { insertPoints([toPoint(l)]); } catch (e) { note('d_watchErr', 'yazma: ' + errText(e)); }
    }
  }).then((x) => { note('d_watchErr', null); if (dead) x.remove(); else sub = x; })
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
  await safe('started', () => Location.hasStartedLocationUpdatesAsync(TASK));
  for (const k of ['d_startAt', 'd_startErr', 'd_taskLast', 'd_taskN', 'd_taskErr', 'd_watchLast', 'd_watchErr']) out[k] = getKV(k, null);
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
