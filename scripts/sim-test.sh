#!/bin/bash
# iOS SİMÜLATÖR ARKA PLAN TESTİ (GitHub Actions macOS'ta çalışır).
# Amaç: uygulama arka plandayken konum gerçekten kaydediliyor mu? Telefon gerekmeden ölçmek.
# Her senaryo: uygulamayı kur → izin ver → hareket simüle et → önde bekle → arka plana at → bekle →
# tekrar öne al; her aşamada uygulamanın kendi veritabanından sayaçları oku.
#   stat tablosu: "<kaynak>-<durum>"  ör. task-background = arka planda saklanan nokta sayısı,
#   beat-background = arka planda JS kalp atışı (5 sn'de bir) — uygulama askıya alındıysa artmaz.
set -uo pipefail

BID=com.kazim.izapp
OUT="$PWD/sim-out"; mkdir -p "$OUT"
APP=$(ls -d ios/dd/Build/Products/Release-iphonesimulator/*.app | head -n1)
EXE=$(basename "$APP" .app)
UDID=$(cat "$OUT/udid")
ROUTE="40.4093,49.8671 40.4180,49.8800 40.4093,49.8671 40.4180,49.8800"
echo "APP=$APP EXE=$EXE UDID=$UDID"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b | tail -n 2

DB=""
q() { sqlite3 "$DB" "$1" 2>&1; }

snap() { # $1 etiket
  echo "--- $1 @ $(date +%T)"
  q "select k || ' = ' || n || '  (son ' || time(last/1000,'unixepoch') || ')' from stat order by k;"
  q "select 'points = ' || count(*) || '  ' || ifnull(time(min(t)/1000,'unixepoch'),'-') || ' .. ' || ifnull(time(max(t)/1000,'unixepoch'),'-') from points;"
  q "select k || ' = ' || v from kv where k like 'd_%' and v != 'null';"
  xcrun simctl io "$UDID" screenshot "$OUT/$1.png" >/dev/null 2>&1 || true
}
syslog() { # uygulama sürecinin askıya alınması / locationd kararları
  echo "--- sistem gunlugu (askiya alma / konum yetkisi)"
  xcrun simctl spawn "$UDID" log show --last "$1" --style compact --predicate "(process == \"runningboardd\" AND eventMessage CONTAINS \"app<$BID\" AND (eventMessage CONTAINS \"Suspending\" OR eventMessage CONTAINS \"running-suspended\" OR eventMessage CONTAINS \"locationd\")) OR (process == \"locationd\" AND eventMessage CONTAINS \"$BID\" AND (eventMessage CONTAINS \"CLIUA\" OR eventMessage CONTAINS \"Denying\" OR eventMessage CONTAINS \"not authorized\" OR eventMessage CONTAINS \"arrow state\"))" 2>/dev/null | cut -c1-330 | tail -n 14
}
install() { # $1 izin, $2 kv satırları (SQL values)
  xcrun simctl terminate "$UDID" "$BID" 2>/dev/null
  xcrun simctl uninstall "$UDID" "$BID" 2>/dev/null
  xcrun simctl install "$UDID" "$APP"
  xcrun simctl privacy "$UDID" grant "$1" "$BID"
  xcrun simctl privacy "$UDID" grant motion "$BID" 2>/dev/null
  # İlk açılış yalnız veritabanını oluşturmak için; sonra kapatıp sınama ayarını yazıyoruz.
  xcrun simctl launch "$UDID" "$BID" >/dev/null; sleep 15
  xcrun simctl terminate "$UDID" "$BID"; sleep 2
  DB="$(xcrun simctl get_app_container "$UDID" "$BID" data)/Documents/SQLite/iz.db"
  q "insert or replace into kv(k,v) values $2; delete from stat;"
}

scenario() { # $1 ad, $2 mod, $3 izin, $4 arka planda kaç sn
  local NAME=$1 MODE=$2 PERM=$3 BG=$4
  echo; echo "=================== $NAME  mod=$MODE  izin=$PERM  arka=${BG}sn"
  install "$PERM" "('test_mode','\"$MODE\"'),('rec','true')"
  xcrun simctl location "$UDID" start --speed=3 --interval=1 $ROUTE
  xcrun simctl launch "$UDID" "$BID" >/dev/null; sleep 20
  snap "$NAME-1-onde"
  xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null; sleep "$BG"
  snap "$NAME-2-arkada"
  syslog "$((BG + 10))s"
  xcrun simctl launch "$UDID" "$BID" >/dev/null; sleep 10
  snap "$NAME-3-tekrar-onde"
  xcrun simctl location "$UDID" clear
}

# Üretim ayarı, iki izin türünde de arka planda yaşamalı:
scenario 1-gorev-hepzaman task location-always 120
scenario 2-gorev-kullanirken task location 90

# Üretim kipi (sınama modu yok) + akıllı pil tasarrufu: önce durağan → doğruluk kısılmalı (powerlow),
# sonra hareket → tam doğruluğa dönmeli (powerhigh). Hepsi arka planda.
echo; echo "=================== 4-uretim-akilli  (durgun 70 sn -> hareket 60 sn, arka planda)"
install location-always "('rec','true'),('test_still','30'),('smart','true')"
# "Durgun": 2-3 m içinde ağır ağır oynayan konum (gerçek telefonda GPS'in yerinde sayması gibi)
xcrun simctl location "$UDID" start --speed=0.2 --interval=1 40.40930,49.86710 40.40932,49.86712 40.40930,49.86710 40.40932,49.86712 40.40930,49.86710 40.40932,49.86712 40.40930,49.86710 40.40932,49.86712 40.40930,49.86710 40.40932,49.86712
xcrun simctl launch "$UDID" "$BID" >/dev/null; sleep 20
snap "4-uretim-1-onde-durgun"
xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null; sleep 70
snap "4-uretim-2-arkada-durgun"
xcrun simctl location "$UDID" start --speed=3 --interval=1 $ROUTE; sleep 60
snap "4-uretim-3-arkada-hareket"
syslog 150s
xcrun simctl launch "$UDID" "$BID" >/dev/null; sleep 12
snap "4-uretim-4-tekrar-onde"
xcrun simctl location "$UDID" clear

echo; echo "=== cokme kayitlari"
ls ~/Library/Logs/DiagnosticReports/ 2>/dev/null | grep -i "^$EXE" | tail -n 5 || echo "yok"
cp ~/Library/Logs/DiagnosticReports/${EXE}* "$OUT/" 2>/dev/null || true
echo "BITTI"
