// expo-sqlite eşdeğeri Node'un yerleşik SQLite'ı üzerinde (yalnız uygulamanın kullandığı eş zamanlı çağrılar).
import { DatabaseSync } from 'node:sqlite';
export function openDatabaseSync() {
  const db = new DatabaseSync(':memory:');
  return {
    execSync: (sql) => db.exec(sql),
    getAllSync: (sql, ...p) => db.prepare(sql).all(...p),
    getFirstSync: (sql, ...p) => db.prepare(sql).get(...p) ?? null,
    runSync: (sql, ...p) => { const r = db.prepare(sql).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withTransactionSync: (fn) => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}
