'use strict';
// İZ veri aktarımı — sunucu (sync.js) ve yönetim aracı (admin.js) ortak parçaları:
// .env okuma, veritabanı bağlantısı, satır şifreleme / çözme.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

// .env (KEY=VALUE satırları). Dosyadaki değer her zaman geçerli — pm2'nin sakladığı eski ortam ezilsin.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
} catch (e) { /* .env yok: yalnız ortam değişkenleri */ }

// Şifreleme anahtarı (32 bayt, 64 hex) YALNIZ .env'de durur — veritabanında değil. Veritabanı dökümü / yedeği
// tek başına ele geçse bile konumlar okunamaz. Anahtar kaybolursa veri de okunamaz (yedeği yok, bilerek).
const ENC = Buffer.from(process.env.SYNC_KEY || '', 'hex');
if (ENC.length !== 32) { console.error('SYNC_KEY (64 hex) .env içinde yok — duruyorum'); process.exit(1); }

// Veritabanı: ayrı 'iz' veritabanı, ayrı 'izsync' rolü. Unix soketinden "peer" kimliğiyle bağlanılır: süreç
// izsync işletim sistemi kullanıcısıyla çalıştığı için parola yok (çalınacak parola da yok); TCP'den giriş yok.
const pool = new Pool({
  host: process.env.PGHOST || '/var/run/postgresql',
  database: process.env.PGDATABASE || 'iz',
  user: process.env.PGUSER || 'izsync',
  max: 4,
  idleTimeoutMillis: 30e3,
});

// Satır şifreleme: AES-256-GCM, her satıra ayrı rastgele 12 baytlık iv.
// AAD (şifreye bağlı ama şifrelenmeyen bilgi) = cihaz:tablo:anahtar — şifreli bir satır başka cihazın ya da başka
// bir zamanın yerine kopyalanırsa çözülmez (değiştirilmiş sayılır).
// Saklanan biçim: iv(12) | etiket(16) | şifreli metin
function seal(dev, tb, k, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC, iv);
  c.setAAD(Buffer.from(dev + ':' + tb + ':' + k));
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function open(dev, tb, k, buf) {
  const d = crypto.createDecipheriv('aes-256-gcm', ENC, buf.subarray(0, 12));
  d.setAAD(Buffer.from(dev + ':' + tb + ':' + k));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

module.exports = { pool, seal, open, sha256 };
