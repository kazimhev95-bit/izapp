'use strict';
// İZ veri aktarımı — yönetim aracı (sunucuda, izsync kullanıcısıyla çalışır):
//   sudo -u izsync node /opt/iz-sync/admin.js list
//   sudo -u izsync node /opt/iz-sync/admin.js export <cihaz> [GG başı] [GG sonu]   > iz-veri.csv
//        tarih YYYY-MM-DD (Bakü saati); çıktı telefonun «Dışa aktar» CSV'siyle aynı biçim (v2) —
//        scripts/csv2json.js doğrudan okur
//   sudo -u izsync node /opt/iz-sync/admin.js wipe <cihaz> [GG başı] [GG sonu]     aralık yoksa HEPSİ
//   sudo -u izsync node /opt/iz-sync/admin.js revoke <cihaz>                       cihaz bir daha yazamaz/okuyamaz
//   sudo -u izsync node /opt/iz-sync/admin.js remove <cihaz>                       cihaz + tüm verisi tamamen gider
// <cihaz>: kimliğin ilk birkaç harfi (list'te görünür) — tek bir cihaza denk gelmeli.
const { pool, open } = require('./lib');

const [cmd, who, a1, a2] = process.argv.slice(2);
const day = (s) => Date.parse(s + 'T00:00:00+04:00'); // Bakü: UTC+4, yaz saati yok
const fmt = (t) => (t == null ? '-' : new Date(+t + 4 * 3600e3).toISOString().slice(0, 16).replace('T', ' '));

async function pick() {
  if (!who || !/^[0-9a-f]{2,32}$/.test(who)) throw new Error('cihaz kimliği (ilk harfleri) gerekli');
  const r = await pool.query("SELECT n, id FROM dev WHERE id LIKE $1 || '%'", [who]);
  if (r.rows.length !== 1) throw new Error(r.rows.length ? 'birden çok cihaz eşleşti, daha uzun yaz' : 'cihaz yok');
  return r.rows[0];
}
// Tarih aralığı: yalnız başlangıç verilirse o gün; ikisi de yoksa tümü
function range() {
  if (!a1) return null;
  const from = day(a1), to = a2 ? day(a2) + 86400e3 : from + 86400e3;
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('tarih YYYY-MM-DD olmalı');
  return [from, to];
}

async function list() {
  const r = await pool.query(
    'SELECT d.n, d.id, d.info, d.created, d.seen, d.revoked, r.tb, count(r.k)::int AS c, min(r.t) AS a, max(r.t) AS b, coalesce(sum(length(r.d)), 0)::bigint AS bytes ' +
    'FROM dev d LEFT JOIN rec r ON r.dev = d.n GROUP BY d.n, r.tb ORDER BY d.n, r.tb');
  const by = new Map();
  for (const x of r.rows) {
    if (!by.has(x.n)) by.set(x.n, { ...x, tbs: [], bytes: 0, a: null, b: null });
    const o = by.get(x.n);
    if (x.tb) {
      o.tbs.push(x.tb + '=' + x.c); o.bytes += +x.bytes;
      if (x.tb !== 'm') { o.a = o.a == null ? +x.a : Math.min(o.a, +x.a); o.b = o.b == null ? +x.b : Math.max(o.b, +x.b); }
    }
  }
  for (const o of by.values()) {
    console.log(o.id.slice(0, 12) + (o.revoked ? '  [İPTAL]' : '') + '  ' + (o.info || '') + '\n' +
      '   kayıt ' + fmt(o.created.getTime()) + ' · son görülme ' + (o.seen ? fmt(o.seen.getTime()) : '-') + '\n' +
      '   ' + (o.tbs.join(' ') || 'veri yok') + ' · ' + (o.bytes / 1048576).toFixed(2) + ' MB · ' + fmt(o.a) + ' .. ' + fmt(o.b));
  }
  if (!by.size) console.log('kayıtlı cihaz yok');
}

async function exportCsv() {
  const d = await pick(), rg = range();
  const q = (tb) => pool.query('SELECT k, t, d FROM rec WHERE dev = $1 AND tb = $2' + (rg ? ' AND t >= $3 AND t < $4' : '') + ' ORDER BY t, k', rg ? [d.n, tb, ...rg] : [d.n, tb]);
  const rows = async (tb) => (await q(tb)).rows.map((x) => ({ k: +x.k, t: +x.t, v: open(d.n, tb, +x.k, x.d) }));
  const n = (v) => (v == null ? '' : Math.round(v * 100) / 100);
  const csv = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/[\r\n]+/g, ' ') + '"';
  const out = ['# iz-veri v2  (P: konum noktasi, A: hareket kaydi, L: olay gunlugu, B: pil) — sunucudan, cihaz ' + d.id.slice(0, 8), 'P,t,lat,lon,acc,spd,crs,hpa'];
  for (const { t, v } of await rows('p')) out.push('P,' + t + ',' + v[0].toFixed(6) + ',' + v[1].toFixed(6) + ',' + n(v[2]) + ',' + n(v[3]) + ',' + n(v[4]) + ',' + n(v[5]));
  out.push('B,t,lvl,chg,mode');
  for (const { t, v } of await rows('b')) out.push('B,' + t + ',' + v[0] + ',' + v[1] + ',' + (v[2] || ''));
  out.push('A,t,k,c');
  for (const { t, v } of await rows('a')) out.push('A,' + t + ',' + v[0] + ',' + v[1]);
  // Ayarlar: aralığın sonuna kadarki en son anlık görüntüden
  const m = await pool.query('SELECT k, d FROM rec WHERE dev = $1 AND tb = $2' + (rg ? ' AND t < $3' : '') + ' ORDER BY k DESC LIMIT 1', rg ? [d.n, 'm', rg[1]] : [d.n, 'm']);
  if (m.rows[0]) {
    const meta = open(d.n, 'm', +m.rows[0].k, m.rows[0].d);
    // telefonda kv değerleri JSON metni olarak durur ('"birebir"') — telefonun dışa aktarması gibi çözülmüş yaz
    const kv = (k) => { try { return JSON.parse(meta.kv[k]); } catch (e) { return meta.kv[k]; } };
    for (const k of ['profile', 'smart', 'still_s', 'lock']) if (meta.kv[k] != null) out.push('K,' + k + ',' + kv(k));
    out.push('# yerler: ' + JSON.stringify(meta.places.map((p) => [p.id, p.name, p.kind])), '# duzeltmeler: ' + JSON.stringify(meta.overrides));
  }
  out.push('L,t,k,v');
  for (const { t, v } of await rows('l')) out.push('L,' + t + ',' + v[1] + ',' + csv(v[2]));
  process.stdout.write(out.join('\n') + '\n');
}

async function wipe() {
  const d = await pick(), rg = range();
  const r = rg ? await pool.query('DELETE FROM rec WHERE dev = $1 AND t >= $2 AND t < $3', [d.n, ...rg]) : await pool.query('DELETE FROM rec WHERE dev = $1', [d.n]);
  console.log(d.id.slice(0, 12) + ': ' + r.rowCount + ' satır silindi' + (rg ? ' (' + a1 + (a2 ? ' .. ' + a2 : '') + ')' : ' (hepsi)'));
}

async function revoke() {
  const d = await pick();
  await pool.query('UPDATE dev SET revoked = true WHERE n = $1', [d.n]);
  console.log(d.id.slice(0, 12) + ': iptal edildi (servis en geç 1 dk içinde reddetmeye başlar). Veri durur; silmek için: wipe');
}

// Cihazı tamamen kaldır: kaydı + tüm verisi (sınama cihazı ya da artık kullanılmayan telefon). Yeri boşalır.
async function remove() {
  const d = await pick();
  const r = await pool.query('DELETE FROM dev WHERE n = $1', [d.n]); // rec satırları ON DELETE CASCADE ile gider
  console.log(d.id.slice(0, 12) + ': cihaz ve tüm verisi kaldırıldı (' + r.rowCount + ')');
}

const CMDS = { list, export: exportCsv, wipe, revoke, remove };
(CMDS[cmd] || (async () => { console.log('komutlar: list | export <cihaz> [başı] [sonu] | wipe <cihaz> [başı] [sonu] | revoke <cihaz> | remove <cihaz>'); }))()
  .catch((e) => { console.error('HATA:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
