// Uygulama kilidi kararı (saf fonksiyon — App.js kullanır, test/lock.test.mjs sınar).
//
// Kilit YALNIZ gerçek arka plandan dönüşte gelir: background → active ve en az LOCK_GRACE arkada kalmışsa.
// Face ID penceresi, Kontrol Merkezi, bildirim ve iOS izin pencereleri uygulamayı yalnız inactive yapar
// (active → inactive → active) — bunlar kilitlemez.
//
// Neden: 1.0.19'da kural "her active olunca, son arka plan 30 sn'den eskiyse kilitle" idi ve arka plan anı hiç
// sıfırlanmıyordu → Face ID başarılı olur → pencere kapanınca active → yeniden kilit → yeniden Face ID: sonsuz döngü
// (kullanıcının olay günlüğü, 1 Eki 19:36:26–38: 2 sn'de bir "kilit açıldı", 6 kez; kilidi kapatınca durdu).
export const LOCK_GRACE = 30e3; // ms — bu kadar kısa süre arkada kaldıysa yeniden sorma (bildirime bakıp dönme)

// prev → next: AppState geçişi; bgAt: uygulamanın en son arka plana gittiği an (0 = yok / kilit sonrası sıfırlandı);
// on: kilit ayarı açık mı. Dönüş: şimdi kilitlenmeli mi.
export function shouldLock(prev, next, bgAt, now, on) {
  return !!on && next === 'active' && prev === 'background' && bgAt > 0 && now - bgAt > LOCK_GRACE;
}
