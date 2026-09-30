#!/bin/bash
# İZ yol eşleştirme verisi: Azerbaycan OSM haritasından iki yol ağı hazırlar.
#   data/foot  — yaya (yaya yolları + tüm caddeler; büyük caddeler "trunk" da dahil)
#   data/car   — araç (araba + otobüs)
# Kullanım:  bash build.sh            -> Geofabrik'ten en yeni haritayı indirip ikisini yeniden kurar
#            bash build.sh dosya.pbf  -> verilen haritadan kurar
# Yeni ağlar önce data/new altında kurulur, sonra eskisiyle yer değiştirir (servis kesintisi ~2 sn).
set -euo pipefail
cd /opt/iz-harita
B=osrm/binding

# 1) Harita dosyası: "latest" bağlantısı bazen yönlendirme döngüsüne giriyor -> tarihli en yeni dosyaya düş
PBF=${1:-}
if [ -z "$PBF" ]; then
  PBF=data/az.osm.pbf
  U=https://download.geofabrik.de/asia
  if ! curl -fsSL --max-redirs 3 -o "$PBF.tmp" "$U/azerbaijan-latest.osm.pbf"; then
    F=$(curl -fsSL "$U/azerbaijan.html" | grep -oE 'azerbaijan-[0-9]{6}\.osm\.pbf' | sort -u | tail -1)
    echo "latest indirilemedi, tarihli dosya: $F"
    curl -fsSL -o "$PBF.tmp" "$U/$F"
  fi
  mv "$PBF.tmp" "$PBF"
fi
echo "harita: $PBF ($(du -h "$PBF" | cut -f1))"

# 2) Yaya profili: OSRM'in foot.lua'sı "trunk" (büyük cadde) yollarını dışlıyor; Bakü'de ana caddeler
#    trunk etiketli ve kaldırımları çoğu yerde ayrıca çizilmemiş -> yürüyüş o caddeye oturtulamaz,
#    paralel ara sokağa kayar. trunk'ı yürüme hızıyla ekliyoruz.
awk '{ if ($1=="primary" && $3=="walking_speed,") { print "        trunk           = walking_speed,"; print "        trunk_link      = walking_speed,"; } print }' profiles/foot.lua > profiles/foot-iz.lua
grep -q "trunk " profiles/foot-iz.lua || { echo "foot-iz.lua yamasi tutmadi"; exit 1; }

# 3) Kurulum: extract -> partition -> customize (MLD). Tek iş parçacığı + düşük öncelik:
#    aynı sunucudaki CRM vb. servisler yavaşlamasın.
rm -rf data/new && mkdir -p data/new/foot data/new/car
for P in foot car; do
  PROF=profiles/$P.lua; [ $P = foot ] && PROF=profiles/foot-iz.lua
  ln -f "$PBF" data/new/$P/az.osm.pbf
  nice -n 15 $B/osrm-extract -t 1 -p $PROF data/new/$P/az.osm.pbf
  nice -n 15 $B/osrm-partition -t 1 data/new/$P/az.osrm
  nice -n 15 $B/osrm-customize -t 1 data/new/$P/az.osrm
  rm -f data/new/$P/az.osm.pbf
done

# 4) Yer değiştir + servisleri yeniden başlat (ilk kurulumda servis yoksa sessizce geç)
for P in foot car; do
  rm -rf data/old-$P; [ -d data/$P ] && mv data/$P data/old-$P
  mv data/new/$P data/$P
done
rm -rf data/new data/old-foot data/old-car
pm2 restart iz-osrm-foot iz-osrm-car 2>/dev/null || true
echo "TAMAM $(date)"
