// Ek telefon özellikleri: adım sayısı (hareket işlemcisi) ve ham veriyi dosya olarak paylaşma.
// Web önizlemesi için eşdeğeri: extras.web.js
import { Share } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { File, Paths } from 'expo-file-system';
import { getPoints, getActivity } from './store';

// [a, b] (ms) aralığında atılan adım. iPhone son 7 günü saklar; izin yoksa / eski tarihse null döner.
export async function stepsBetween(a, b) {
  try {
    if (b <= a || !(await Pedometer.isAvailableAsync())) return null;
    const r = await Pedometer.getStepCountAsync(new Date(a), new Date(b));
    return r && typeof r.steps === 'number' ? r.steps : null;
  } catch (e) { return null; }
}

// Hareket ve Fitness izni (adım + yürüyor/araçta ayrımı aynı izne bağlı). Dönüş: true/false
export async function askMotion() {
  try { return (await Pedometer.requestPermissionsAsync()).granted; } catch (e) { return false; }
}

// Ham kayıtları (konum noktaları + hareket kayıtları) CSV dosyası yapıp iOS paylaşım penceresini açar.
// Amaç: gerçek veriyle ayar yapmak — dosyayı bilgisayara gönderince düzeltme/tür eşikleri onunla denenir.
// Dönüş: dışa aktarılan nokta sayısı.
export async function exportData(from, to) {
  const pts = getPoints(from, to), acts = getActivity(from, to);
  const n = (v) => (v == null ? '' : Math.round(v * 100) / 100);
  const lines = ['# iz-veri v1  (P: konum noktasi, A: hareket kaydi)', 'P,t,lat,lon,acc,spd,crs'];
  for (const p of pts) lines.push('P,' + p.t + ',' + p.lat.toFixed(6) + ',' + p.lon.toFixed(6) + ',' + n(p.acc) + ',' + n(p.spd) + ',' + n(p.crs));
  lines.push('A,t,k,c');
  for (const a of acts) lines.push('A,' + a.t + ',' + a.k + ',' + a.c);
  const d = new Date();
  const f = new File(Paths.cache, 'iz-veri-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + '.csv');
  f.create({ overwrite: true });
  f.write(lines.join('\n'));
  await Share.share({ url: f.uri });
  return pts.length;
}
