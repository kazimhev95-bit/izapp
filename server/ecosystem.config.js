// pm2 süreçleri (VDS: /opt/iz-harita). Başlat: pm2 start ecosystem.config.js && pm2 save
//   iz-osrm-foot / iz-osrm-car — OSRM 5.27.1 yol eşleştirme motorları (yalnız sunucu içinden erişilir)
//   iz-harita                  — telefonun konuştuğu servis (server.js); nginx arkasında
// --mmap: yol ağı belleğe kopyalanmaz, diskten eşlenir (aynı sunucudaki CRM vb. için bellek kalsın).
const OSRM = (port, dir) => '--algorithm mld --ip 127.0.0.1 --port ' + port + ' --max-matching-size 1000 --threads 2 --mmap 1 data/' + dir + '/az.osrm';

module.exports = {
  apps: [
    { name: 'iz-osrm-foot', cwd: '/opt/iz-harita', script: 'osrm/binding/osrm-routed', interpreter: 'none', args: OSRM(3701, 'foot'), max_memory_restart: '700M', restart_delay: 5000 },
    { name: 'iz-osrm-car', cwd: '/opt/iz-harita', script: 'osrm/binding/osrm-routed', interpreter: 'none', args: OSRM(3702, 'car'), max_memory_restart: '700M', restart_delay: 5000 },
    { name: 'iz-harita', cwd: '/opt/iz-harita', script: 'server.js', max_memory_restart: '200M' },
  ],
};
