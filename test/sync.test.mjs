// Telefon aktarım mantığını (src/store.js + src/sync.js, GERÇEK kod) Node'da, CANLI sunucuya karşı dener:
//   node test/sync.test.mjs
// Expo modülleri test/shim sahteleriyle değişir (SQLite = Node'un yerleşik SQLite'ı). Saat ileri sarılabilir
// (Date.now yaması) — Wi-Fi 1 dk / mobil 10 dk aralığı beklemeden sınanır. Sonda sınama cihazı sunucudan silinir
// (yeri boşalsın diye ayrıca: admin.js remove <kimlik>).
import { register } from 'node:module';
import fs from 'node:fs';

register('./shim/hooks.mjs', import.meta.url);
process.env.EXPO_PUBLIC_IZ_KEY = (fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/EXPO_PUBLIC_IZ_KEY=(.+)/) || [])[1]?.trim();

let skew = 0; // saat ileri sarma
const realNow = Date.now;
Date.now = () => realNow() + skew;

const store = await import('../src/store.js');
const sync = await import('../src/sync.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'GEÇTİ ' : 'KALDI ') + m); if (!c) fails++; };
const sum = (o) => o.p + o.a + o.b + o.l;
const wait = async () => { for (let i = 0; i < 200 && sync.status.busy; i++) await new Promise((r) => setTimeout(r, 50)); };

// 1) Telefonda "eski" kayıtlar: 2500 nokta, hareket, pil, günlük, bir yer + düzeltme
const T = realNow() - 3 * 3600e3;
store.insertPoints(Array.from({ length: 2500 }, (_, i) => ({ t: T + i * 1000, lat: 40.4093 + i * 1e-6, lon: 49.8671 + i * 1e-6, acc: 4.567, spd: 1.234, crs: null, hpa: 1012.345 })));
store.insertActivity(T, 'W', 2); store.insertActivity(T + 60e3, 'A', 1);
store.insertBattery(T, 88, 0, 'high'); store.insertBattery(T + 600e3, -100, 1, null);
store.addLog('ayar', 'profil: birebir'); store.addLog('düğme', null); store.addLog('uzun', 'x'.repeat(5000));
const pid = store.addPlace({ lat: 40.41, lon: 49.87, name: 'Ev', kind: 'home' });
store.setOverride(T, 'bus');
let p = sync.pending();
ok(p.p === 2500 && p.a === 2 && p.b === 2 && p.l === 3, 'göç: eski satırların hepsi bekliyor ' + JSON.stringify(p));

// 2) Wi-Fi: ilk tik hemen aktarır (kayıt + 3 parti konum + diğerleri + meta)
globalThis.__net = 'wifi';
await sync.tick();
ok(!sync.status.err, 'ilk aktarım hatasız' + (sync.status.err ? ': ' + sync.status.err : ''));
// turun kendi yazdığı 'aktarım çalışıyor' günlük satırı gönderimden SONRA yazılır → bir sonraki turda gider
{ const q = sync.pending(); ok(q.p + q.a + q.b === 0 && q.l <= 1, 'bekleyen kalmadı (turun kendi günlük satırı hariç) ' + JSON.stringify(q)); }
ok(globalThis.__ssOpt && globalThis.__ssOpt.keychainAccessible === 'afu-tdo', 'anahtar Anahtarlık\'ta "ilk kilit açılışından sonra, yalnız bu cihaz" erişimiyle');
const dev = JSON.parse(globalThis.__ss.get('iz_sync_cred')).dev;
ok(sync.deviceId() === dev.slice(0, 8), 'cihaz kaydoldu ' + sync.deviceId());
let s = await sync.serverInfo();
ok(s.n.p === 2500 && s.n.a === 2 && s.n.b === 2 && s.n.l >= 3 && s.n.m === 1, 'sunucuda: ' + JSON.stringify(s.n));

// 3) Yeni nokta: 1 dk dolmadan gitmez; dolunca gider. Meta değişmediyse yeniden gitmez.
store.insertPoints([{ t: realNow() - 1000, lat: 40.42, lon: 49.88, acc: 5, spd: null, crs: null, hpa: null }]);
skew += 30e3; await sync.tick();
ok(sync.pending().p === 1, 'Wi-Fi: 30 sn sonra gitmedi (bekliyor)');
skew += 31e3; await sync.tick();
ok(sync.pending().p === 0, 'Wi-Fi: 61 sn sonra gitti');
s = await sync.serverInfo();
ok(s.n.m === 1, 'yerler/ayarlar değişmedi → meta yeniden gitmedi');

// 4) Mobil veri: 10 dk aralık
globalThis.__net = 'cell';
store.insertPoints([{ t: realNow() - 500, lat: 40.43, lon: 49.89, acc: 5, spd: null, crs: null, hpa: null }]);
skew += 2 * 60e3; await sync.tick();
ok(sync.pending().p === 1, 'mobil: 2 dk sonra gitmedi');
skew += 5 * 60e3; await sync.tick();
ok(sync.pending().p === 1, 'mobil: 7 dk sonra gitmedi');
skew += 3.5 * 60e3; await sync.tick();
ok(sync.pending().p === 0 && sync.status.net === 'cell', 'mobil: 10,5 dk sonra gitti');

// 5) İnternet yok: kayıt telefonda birikir, gelince kaldığı yerden
globalThis.__net = 'none';
store.insertPoints([{ t: realNow() - 300, lat: 40.44, lon: 49.9, acc: 5, spd: null, crs: null, hpa: null }]);
skew += 20 * 60e3; await sync.tick();
ok(sync.pending().p === 1, 'internetsiz: bekliyor');
globalThis.__net = 'wifi'; skew += 60e3; await sync.tick();
ok(sync.pending().p === 0, 'internet gelince gitti');

// 6) Yer adı değişti → meta yeniden gider (sunucuda 2 anlık görüntü)
store.updatePlace(pid, 'Ev (yeni)', 'home');
skew += 61e3; await sync.tick();
s = await sync.serverInfo();
ok(s.n.m === 2 && s.n.p === 2503, 'yer adı değişti → yeni meta; toplam nokta 2503 (' + JSON.stringify(s.n) + ')');

// 7) Anahtarlık okunamıyor (telefon açıldı, kilit hiç açılmadı): yeni kimlik ÜRETİLMEMELİ
globalThis.__ssFail = true;
const before = globalThis.__ss.get('iz_sync_cred');
// bellekteki kimlik önbelleği varken Anahtarlık okunmaz; yeni süreç gibi davranmak için modülü taze yükle
const sync2 = await import('../src/sync.js?taze');
store.insertPoints([{ t: realNow() - 200, lat: 40.45, lon: 49.91, acc: 5, spd: null, crs: null, hpa: null }]);
await sync2.tick();
ok(globalThis.__ss.get('iz_sync_cred') === before && /anahtarlık/.test(sync2.status.err || ''), 'Anahtarlık kilitli: kimlik korunuyor, tur iptal (' + sync2.status.err + ')');
globalThis.__ssFail = false;

// 8) Hata beklemesi: sunucu kapalıymış gibi (yanlış uygulama anahtarı yok — bağlantı hatası taklidi zor) → atla.
// 9) Şimdi aktar (force) süre beklemeden gider
await sync.tick(true);
ok(sync.pending().p === 0, 'Şimdi aktar: bekleyen gitti');

// 10) Sunucudaki verimi sil
const del = await sync.wipeServer();
s = await sync.serverInfo();
ok(del >= 2504 && !Object.keys(s.n).length, 'sunucudaki veri silindi: ' + del + ' satır, kalan ' + JSON.stringify(s.n));
ok(store.pointStats().n === 2504, 'telefondaki veri duruyor (' + store.pointStats().n + ')');
const logs = store.getLogs(0, Date.now() + 1, 50).map((r) => r.k + ': ' + r.v);
ok(logs.some((l) => /kaydedildi/.test(l)) && logs.some((l) => /silindi/.test(l)), 'günlükte kayıt + silme satırları var');
ok(logs.filter((l) => /aktarım çalışıyor/.test(l)).length <= 2, 'başarılı turlar günlüğü şişirmiyor');

// Sınama cihazını sunucudan tamamen kaldır (cihaz sınırı 2 — telefonun yeri kalsın)
const { execSync } = await import('node:child_process');
const os = await import('node:os');
console.log('\n' + execSync('ssh -i ' + os.homedir() + '/.ssh/vultr_crm root@80.240.17.26 "cd /tmp && sudo -u izsync node /opt/iz-sync/admin.js remove ' + dev + '"').toString().trim());
console.log(fails ? fails + ' KALDI' : 'TÜMÜ GEÇTİ');
process.exit(fails ? 1 : 0);
