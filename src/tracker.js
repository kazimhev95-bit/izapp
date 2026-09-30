// Arka plan konum kaydı. Görev (task) MODÜL YÜKLENİRKEN tanımlanmalı: iOS uygulamayı arka planda
// uyandırdığında arayüz açılmaz, yalnız bu dosya çalışır (index.js'te en başta import edilir).
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { insertPoints } from './store';

const TASK = 'iz-konum-kaydi';

TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error || !data || !data.locations) return;
  try {
    insertPoints(data.locations.map((l) => ({
      t: Math.round(l.timestamp), lat: l.coords.latitude, lon: l.coords.longitude,
      acc: l.coords.accuracy, spd: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    })));
  } catch (e) { /* tek bir yazma hatası kaydı durdurmasın */ }
});

// Hassasiyet profilleri: 'hassas' hız/tür ayrımı için en iyisi; 'pil' daha seyrek ve kaba.
const PROFILES = {
  hassas: { accuracy: Location.Accuracy.High, distanceInterval: 15 },
  pil: { accuracy: Location.Accuracy.Balanced, distanceInterval: 40 },
};

// İzin + çalışma durumu. bg: 'Her Zaman' izni (uygulama kapalıyken de kayıt için gerekli).
export async function status() {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  const running = await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);
  return { fg: fg.granted, bg: bg.granted, canAskBg: bg.canAskAgain, running };
}

// Kaydı başlatır. Önce "kullanırken", sonra "her zaman" izni istenir (iOS bu sırayı şart koşar).
export async function start(profile = 'hassas') {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return status();
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(TASK);
  await Location.startLocationUpdatesAsync(TASK, {
    ...(PROFILES[profile] || PROFILES.hassas),
    activityType: Location.ActivityType.Other,
    pausesUpdatesAutomatically: false, // iOS durunca kaydı kendi kesmesin; tekrar başlatmayabiliyor
    // "Her Zaman" izni yoksa arka planda çalışmanın tek yolu mavi gösterge çubuğudur.
    showsBackgroundLocationIndicator: !bg.granted,
  });
  return status();
}

export async function stop() {
  if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(TASK);
  return status();
}

// Koordinat -> kısa adres (iOS'un kendi servisi; ücretsiz, anahtar gerekmez).
export async function geocode(lat, lon) {
  try {
    const r = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }))[0];
    if (!r) return null;
    return r.name || r.street || r.district || r.city || null;
  } catch (e) { return null; }
}
