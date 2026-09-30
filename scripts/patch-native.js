// npm postinstall: expo-location'ın iOS kaynağına küçük bir yama uygular.
//
// NEDEN: watchPositionAsync'in kullandığı konum yöneticisi kütüphanede
//   allowsBackgroundLocationUpdates = false
// ile kuruluyor; yani uygulama arka plana geçince (telefon kilitlenince) konum gelmesi duruyor.
// Bu yama o yöneticiyi arka planda da çalışır hale getirir (Info.plist'te "location" arka plan modu
// varsa), iOS'un kaydı kendiliğinden duraklatmasını kapatır ve arka planda kayıt sürerken durum
// çubuğunda mavi konum göstergesini açar (kullanıcı kaydın sürdüğünü görsün).
//
// Yama tekrar çalıştırılabilir (zaten uygulanmışsa dokunmaz). Hedef satır bulunamazsa HATA verir:
// kütüphane güncellenmiş demektir, sessizce yamasız derleme çıkmasın.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', 'expo-location', 'ios', 'Providers', 'BaseLocationProvider.swift');
const MARK = '// izapp-patch';
const OLD = 'manager.allowsBackgroundLocationUpdates = false';
const NEW = [
  MARK + ': izleyici arka planda da konum alsin',
  '    let izBgModes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []',
  '    manager.allowsBackgroundLocationUpdates = izBgModes.contains("location")',
  '    manager.pausesLocationUpdatesAutomatically = false',
  '    manager.showsBackgroundLocationIndicator = true',
].join('\n');

if (!fs.existsSync(file)) {
  console.error('[patch-native] bulunamadi: ' + file);
  process.exit(1);
}
let src = fs.readFileSync(file, 'utf8');
if (src.includes(MARK)) {
  console.log('[patch-native] zaten uygulanmis');
} else if (src.includes(OLD)) {
  src = src.replace(OLD, NEW);
  fs.writeFileSync(file, src);
  console.log('[patch-native] uygulandi: BaseLocationProvider.swift');
} else {
  console.error('[patch-native] hedef satir yok — expo-location degismis, yamayi guncelle');
  process.exit(1);
}
