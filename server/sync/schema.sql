-- İZ veri aktarımı şeması (veritabanı 'iz', sahibi 'izsync'). Tekrar çalıştırmak güvenli.
-- Cihazlar: telefonun ürettiği kimlik + gizli anahtarın SHA-256 özeti (anahtarın kendisi saklanmaz).
CREATE TABLE IF NOT EXISTS dev (
  n       serial PRIMARY KEY,
  id      text UNIQUE NOT NULL,
  h       bytea NOT NULL,
  info    text,
  created timestamptz NOT NULL DEFAULT now(),
  seen    timestamptz,
  revoked boolean NOT NULL DEFAULT false
);
-- Kayıtlar: tablo p konum, a hareket, b pil, l olay günlüğü, m yerler/düzeltmeler/ayarlar anlık görüntüsü.
-- d = AES-256-GCM şifreli değerler (iv|etiket|metin); düz duran yalnız zaman (t, ms).
CREATE TABLE IF NOT EXISTS rec (
  dev int    NOT NULL REFERENCES dev(n) ON DELETE CASCADE,
  tb  text   NOT NULL CHECK (tb IN ('p', 'a', 'b', 'l', 'm')),
  k   bigint NOT NULL,
  t   bigint NOT NULL,
  d   bytea  NOT NULL,
  PRIMARY KEY (dev, tb, k)
);
CREATE INDEX IF NOT EXISTS rec_t ON rec (dev, t);
