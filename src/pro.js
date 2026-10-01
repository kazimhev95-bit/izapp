// Pro özellikler (telefon): uygulama kilidi (Face ID / Touch ID / şifre), pil raporu, barometre.
// Web önizlemesi için eşdeğeri: pro.web.js (aynı imzalar, sahte değerler).
import * as LocalAuthentication from 'expo-local-authentication';
import * as Battery from 'expo-battery';
import { Barometer } from 'expo-sensors';
import { getKV, setKV, addLog, insertBattery, getBattery } from './store';

// ---- Uygulama kilidi ----
// Konum geçmişi hassas veridir. Kilit açıkken uygulama her öne gelişinde (LOCK_GRACE'ten uzun arkada kaldıysa)
// Face ID / Touch ID ister; telefonda biyometri yoksa iOS kendi şifre ekranını açar.
export const LOCK_GRACE = 30e3; // ms — bu kadar kısa süre arkada kaldıysa yeniden sorma (bildirim bakıp dönme)
export const lockOn = () => getKV('lock', false);
export function setLock(on) { setKV('lock', !!on); addLog('ayar', 'uygulama kilidi: ' + (on ? 'açık' : 'kapalı')); }
// Telefonda kilit kurulabilir mi? (biyometri ya da şifre kayıtlı)
export async function lockAvailable() {
  try { return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()); } catch (e) { return false; }
}
// Kilidi aç. Dönüş: true = açıldı. İptal/hata = false (ekran kapalı kalır, yeniden denenebilir).
export async function unlock() {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'İZ kilidini aç', cancelLabel: 'Vazgeç', disableDeviceFallback: false });
    addLog('kilit', r.success ? 'açıldı' : 'açılamadı: ' + (r.error || '?'));
    return !!r.success;
  } catch (e) { addLog('kilit', 'hata: ' + String((e && e.message) || e)); return false; }
}

// ---- Pil raporu ----
// Kayıt sürerken 10 dakikada bir pil seviyesi + GPS kipi (tam/navigasyon/kısık) + şarjda mı saklanır.
// Rapor: günün pil düşüşü (şarjdaki süreler ayrı), kip başına saatlik tüketim.
let batTimer = null;
export function startBattery(powerOf) {
  if (batTimer) return;
  const tick = async () => {
    try {
      const [lvl, st] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
      if (lvl == null || lvl < 0) return;
      insertBattery(Date.now(), Math.round(lvl * 100), st === Battery.BatteryState.CHARGING || st === Battery.BatteryState.FULL ? 1 : 0, powerOf());
    } catch (e) { /* pil okunamadı: atla */ }
  };
  tick();
  batTimer = setInterval(tick, 10 * 60e3);
}
export function stopBattery() { if (batTimer) { clearInterval(batTimer); batTimer = null; } }
// [a,b) aralığının pil özeti: {drop: toplam düşüş (% puan, şarjsız), hours, perHour, modes: {high:{h, drop}, nav:…, low:…}, charged: şarjda geçen saat}
export function batteryReport(a, b) {
  const rows = getBattery(a, b);
  const out = { drop: 0, hours: 0, charged: 0, modes: {}, n: rows.length };
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], q = rows[i], h = (q.t - p.t) / 3600e3;
    if (h > 0.5) continue; // uzun boşluk (uygulama kapalı): ölçülemez
    if (p.chg || q.chg) { out.charged += h; continue; }
    const d = Math.max(0, p.lvl - q.lvl);
    out.drop += d; out.hours += h;
    const m = out.modes[p.mode || 'high'] || (out.modes[p.mode || 'high'] = { h: 0, drop: 0 });
    m.h += h; m.drop += d;
  }
  out.perHour = out.hours > 0.25 ? out.drop / out.hours : null;
  for (const m of Object.values(out.modes)) m.perHour = m.h > 0.25 ? m.drop / m.h : null;
  return out;
}

// ---- Barometre ----
// Basınç (hPa) her konum noktasına eklenir. 1 hPa ≈ 8,5 m yükseklik: metroya iniş 2-3 hPa artış, köprü/viyadük düşüş.
// Motor bunu GPS'siz parçada "metro mu tünel mi" ayrımında kullanır (kullanılmıyorsa veri yine kaydedilir — ileride analiz).
let baro = null, baroSub = null;
export function startBarometer() {
  if (baroSub) return;
  Barometer.isAvailableAsync().then((ok) => {
    if (!ok) return;
    Barometer.setUpdateInterval(5000);
    baroSub = Barometer.addListener((m) => { if (m && m.pressure > 300) baro = Math.round(m.pressure * 10) / 10; });
  }).catch(() => {});
}
export function stopBarometer() { if (baroSub) { baroSub.remove(); baroSub = null; } baro = null; }
export const pressure = () => baro;
