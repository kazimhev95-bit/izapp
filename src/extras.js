// Ek telefon özellikleri: adım sayısı (hareket işlemcisi) ve ham veriyi dosya olarak paylaşma.
// Web önizlemesi için eşdeğeri: extras.web.js
import { Share } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { File, Paths } from 'expo-file-system';
import { getPoints, getActivity, getStats, getKV, getLogs, getBattery } from './store';

// [a, b] (ms) aralığında atılan adım. iPhone son 7 günü saklar; izin yoksa / eski tarihse null döner.
export async function stepsBetween(a, b) {
  try {
    if (b <= a || !(await Pedometer.isAvailableAsync())) return null;
    // İzin henüz verilmediyse SORMA (izin penceresi kayıt başlatılırken açılır); sessizce boş dön.
    if (!(await Pedometer.getPermissionsAsync()).granted) return null;
    const r = await Pedometer.getStepCountAsync(new Date(a), new Date(b));
    return r && typeof r.steps === 'number' ? r.steps : null;
  } catch (e) { return null; }
}

// Hareket ve Fitness izni (adım + yürüyor/araçta ayrımı aynı izne bağlı). Dönüş: true/false
export async function askMotion() {
  try { return (await Pedometer.requestPermissionsAsync()).granted; } catch (e) { return false; }
}

// Bir yolculuğu GPX (her harita/spor uygulamasının açtığı standart iz dosyası) olarak paylaşır.
// Ham GPS noktaları zamanıyla yazılır; name: dosyadaki iz adı (ör. "Ev → İş").
export async function exportGpx(trip, name) {
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pts = (trip.raw || trip.pts).filter((q) => !q.syn);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="IZ" xmlns="http://www.topografix.com/GPX/1/1">', '<trk><name>' + esc(name) + '</name><trkseg>'];
  for (const q of pts) lines.push('<trkpt lat="' + q.lat.toFixed(6) + '" lon="' + q.lon.toFixed(6) + '"><time>' + new Date(q.t).toISOString() + '</time></trkpt>');
  lines.push('</trkseg></trk></gpx>');
  const d = new Date(trip.t0), p2 = (n) => String(n).padStart(2, '0');
  const f = new File(Paths.cache, 'iz-yolculuk-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.gpx');
  f.create({ overwrite: true });
  f.write(lines.join('\n'));
  await Share.share({ url: f.uri });
  return pts.length;
}

// Ham kayıtları (konum noktaları + hareket kayıtları) CSV dosyası yapıp iOS paylaşım penceresini açar.
// Amaç: gerçek veriyle ayar yapmak — dosyayı bilgisayara gönderince düzeltme/tür eşikleri onunla denenir.
// Dönüş: dışa aktarılan nokta sayısı.
export async function exportData(from, to) {
  const pts = getPoints(from, to), acts = getActivity(from, to);
  const n = (v) => (v == null ? '' : Math.round(v * 100) / 100);
  const lines = ['# iz-veri v2  (P: konum noktasi, A: hareket kaydi, L: olay gunlugu, B: pil)', 'P,t,lat,lon,acc,spd,crs,hpa'];
  for (const p of pts) lines.push('P,' + p.t + ',' + p.lat.toFixed(6) + ',' + p.lon.toFixed(6) + ',' + n(p.acc) + ',' + n(p.spd) + ',' + n(p.crs) + ',' + n(p.hpa));
  // Pil ölçümleri: seviye, şarjda mı, GPS kipi
  lines.push('B,t,lvl,chg,mode');
  for (const b of getBattery(from, to)) lines.push('B,' + b.t + ',' + b.lvl + ',' + b.chg + ',' + (b.mode || ''));
  lines.push('A,t,k,c');
  for (const a of acts) lines.push('A,' + a.t + ',' + a.k + ',' + a.c);
  // Tanı: sayaçlar (hangi kaynaktan, uygulama hangi durumdayken kaç nokta) ve ayarlar — sorun çözmek için
  lines.push('S,k,n,last');
  const st = getStats();
  for (const k of Object.keys(st)) lines.push('S,' + k + ',' + st[k].n + ',' + (st[k].last || ''));
  const csv = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/[\r\n]+/g, ' ') + '"'; // virgül/tırnak içeren değer
  lines.push('K,profile,' + getKV('profile', 'birebir'), 'K,smart,' + getKV('smart', true), 'K,still_s,' + getKV('still_s', ''), 'K,lock,' + getKV('lock', false));
  // Olay günlüğü: düğmeler, ayarlar, uygulama/kayıt/GPS olayları (eskiden yeniye)
  lines.push('L,t,k,v');
  for (const r of getLogs(from, to).reverse()) lines.push('L,' + r.t + ',' + r.k + ',' + csv(r.v));
  const d = new Date();
  const f = new File(Paths.cache, 'iz-veri-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + '.csv');
  f.create({ overwrite: true });
  f.write(lines.join('\n'));
  await Share.share({ url: f.uri });
  return pts.length;
}
