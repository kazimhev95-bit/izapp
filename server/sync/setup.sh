#!/bin/bash
# İZ veri aktarımı — VDS kurulumu (tekrar çalıştırmak güvenli). Dosyalar önce /opt/iz-sync'e kopyalanmış olmalı:
#   scp server/sync/{lib.js,sync.js,admin.js,schema.sql,package.json,setup.sh} root@VDS:/opt/iz-sync/
#   ssh root@VDS 'bash /opt/iz-sync/setup.sh'
# Yapılanlar: yetkisiz sistem kullanıcısı izsync, Postgres rolü izsync (parolasız, yalnız Unix soketi/peer),
# veritabanı iz (başkasına bağlantı hakkı yok), şema, .env (şifreleme anahtarı üretilir — bir daha DEĞİŞTİRME,
# yoksa eski veri okunamaz), dosya izinleri (kod root'un, izsync yalnız okur).
set -euo pipefail
D=/opt/iz-sync
cd "$D"

id izsync >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin izsync

npm install --omit=dev --no-audit --no-fund --silent

PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt"
[ "$($PSQL -c "SELECT 1 FROM pg_roles WHERE rolname = 'izsync'")" = "1" ] || $PSQL -c "CREATE ROLE izsync LOGIN"
[ "$($PSQL -c "SELECT 1 FROM pg_database WHERE datname = 'iz'")" = "1" ] || $PSQL -c "CREATE DATABASE iz OWNER izsync"
$PSQL -c "REVOKE ALL ON DATABASE iz FROM PUBLIC"
$PSQL -d iz -c "REVOKE ALL ON SCHEMA public FROM PUBLIC"
$PSQL -d iz -c "ALTER SCHEMA public OWNER TO izsync"
sudo -u izsync psql -v ON_ERROR_STOP=1 -q -d iz -f "$D/schema.sql"

if [ ! -f "$D/.env" ]; then
  KEY=$(grep '^IZ_KEY=' /opt/iz-harita/.env | cut -d= -f2-)
  {
    echo "PORT=3703"
    echo "IZ_KEY=$KEY"
    echo "SYNC_KEY=$(openssl rand -hex 32)"
    echo "MAX_DEVICES=2"
    echo "REGISTER=1"
  } > "$D/.env"
  echo ".env yazıldı (yeni şifreleme anahtarı)"
fi

chown -R root:izsync "$D"
chmod -R u=rwX,g=rX,o= "$D"
chmod 640 "$D/.env"
echo "kurulum tamam"
