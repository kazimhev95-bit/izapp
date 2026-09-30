#!/bin/bash
# iOS SİMÜLATÖR ARKA PLAN TESTİ (GitHub Actions macOS'ta çalışır).
# Amaç: uygulama arka plandayken konum gerçekten kaydediliyor mu? Telefon gerekmeden ölçmek.
# Her senaryo: uygulamayı kur → izin ver → hareket simüle et → 35 sn önde → 80 sn arka planda →
# tekrar öne; her aşamada uygulamanın kendi veritabanından sayaçları oku.
#   stat tablosu: "<kaynak>-<durum>"  ör. task-background = görevden arka planda gelen nokta sayısı
set -uo pipefail

BID=com.kazim.izapp
OUT="$PWD/sim-out"; mkdir -p "$OUT"
APP=$(ls -d ios/dd/Build/Products/Release-iphonesimulator/*.app | head -n1)
EXE=$(basename "$APP" .app)
UDID=$(cat "$OUT/udid")
echo "APP=$APP EXE=$EXE UDID=$UDID"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b | tail -n 2

dbfile() { echo "$(xcrun simctl get_app_container "$UDID" "$BID" data)/Documents/SQLite/iz.db"; }
q() { sqlite3 "$(dbfile)" "$1" 2>&1; }

snap() { # $1 etiket
  echo "--- $1 @ $(date +%T)"
  q "select k || ' = ' || n || '  (son ' || time(last/1000,'unixepoch') || ')' from stat order by k;"
  q "select 'points = ' || count(*) || '  ' || ifnull(time(min(t)/1000,'unixepoch'),'-') || ' .. ' || ifnull(time(max(t)/1000,'unixepoch'),'-') from points;"
  q "select k || ' = ' || v from kv where k like 'd_%' and v != 'null';"
  xcrun simctl io "$UDID" screenshot "$OUT/$1.png" >/dev/null 2>&1 || true
  if pgrep -f "/$EXE.app/$EXE" >/dev/null; then echo "surec: CALISIYOR"; else echo "surec: YOK (oldurulmus/cokmus)"; fi
}

scenario() { # $1 ad, $2 mod (task|watch|both), $3 izin (location|location-always)
  local NAME=$1 MODE=$2 PERM=$3
  echo; echo "=================== $NAME  mod=$MODE  izin=$PERM"
  xcrun simctl terminate "$UDID" "$BID" 2>/dev/null
  xcrun simctl uninstall "$UDID" "$BID" 2>/dev/null
  xcrun simctl install "$UDID" "$APP"
  xcrun simctl privacy "$UDID" grant "$PERM" "$BID"
  xcrun simctl privacy "$UDID" grant motion "$BID" 2>/dev/null
  # İlk açılış yalnız veritabanını oluşturmak için; sonra kapatıp sınama ayarını yazıyoruz.
  xcrun simctl launch "$UDID" "$BID" >/dev/null; sleep 15
  xcrun simctl terminate "$UDID" "$BID"; sleep 2
  q "insert or replace into kv(k,v) values('test_mode','\"$MODE\"'),('rec','true'); delete from stat;"
  # Hareket: ~3 m/sn, saniyede bir konum
  xcrun simctl location "$UDID" start --speed=3 --interval=1 40.4093,49.8671 40.4180,49.8800 40.4093,49.8671 40.4180,49.8800
  xcrun simctl launch "$UDID" "$BID" >/dev/null; sleep 25
  snap "$NAME-1-onde"
  xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null; sleep 75
  snap "$NAME-2-arkada"
  echo "--- sistem gunlugu: surec neden askiya alindi? (runningboardd / locationd)"
  xcrun simctl spawn "$UDID" log show --last 90s --style compact --predicate "(process == \"runningboardd\" OR process == \"locationd\") AND eventMessage CONTAINS \"$BID\" AND (eventMessage CONTAINS[c] \"suspend\" OR eventMessage CONTAINS[c] \"assertion\" OR eventMessage CONTAINS[c] \"background\" OR eventMessage CONTAINS[c] \"inuse\" OR eventMessage CONTAINS[c] \"authoriz\")" 2>/dev/null | cut -c1-420 | tail -n 45
  xcrun simctl launch "$UDID" "$BID" >/dev/null; sleep 12
  snap "$NAME-3-tekrar-onde"
  xcrun simctl location "$UDID" clear
}

scenario A-gorev-hepzaman task location-always
scenario D-gorev-kullanirken task location
scenario E-izleyici-kullanirken watch location
scenario F-ikisi-hepzaman both location-always
scenario G-gorev-gosterge-hepzaman taskind location-always

echo; echo "=== cokme kayitlari"
ls -la ~/Library/Logs/DiagnosticReports/ 2>/dev/null | grep -i "$EXE" | tail -n 5 || echo "yok"
cp ~/Library/Logs/DiagnosticReports/${EXE}* "$OUT/" 2>/dev/null || true
echo "BITTI"
