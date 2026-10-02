// Web önizlemesi: kilit / pil / barometre gerçek değil — arayüzü görmek için sahte değerler.
import { getKV, setKV, addLog, insertBattery, getBattery } from './store';

export { LOCK_GRACE } from './lockrule';
export const lockOn = () => getKV('lock', false);
export function setLock(on) { setKV('lock', !!on); addLog('ayar', 'uygulama kilidi: ' + (on ? 'açık' : 'kapalı')); }
export async function lockAvailable() { return true; }
export async function unlock() { return window.confirm('Face ID (önizleme): kilidi aç?'); }

// Pil: önizlemede yapay bir gün üret (saatte %4 tam, %2 kısık)
let seeded = false;
export function startBattery(powerOf) {
  if (seeded) return; seeded = true;
  const now = Date.now(); let lvl = 92;
  for (let i = 60; i >= 0; i--) { const t = now - i * 10 * 60e3, mode = i > 30 ? 'low' : i > 10 ? 'high' : 'nav'; lvl -= mode === 'low' ? 0.33 : mode === 'nav' ? 0.9 : 0.65; insertBattery(t, Math.round(lvl), 0, mode); }
}
export function stopBattery() {}
export function batteryReport(a, b) {
  const rows = getBattery(a, b);
  const out = { drop: 0, hours: 0, charged: 0, modes: {}, n: rows.length };
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], q = rows[i], h = (q.t - p.t) / 3600e3;
    if (h > 0.5) continue;
    if (p.chg || q.chg) { out.charged += h; continue; }
    const d = Math.max(0, p.lvl - q.lvl);
    out.drop += d; out.hours += h;
    const m = out.modes[p.mode || 'high'] || (out.modes[p.mode || 'high'] = { h: 0, drop: 0 });
    m.h += h; m.drop += d;
  }
  out.perHour = out.hours > 0.25 ? out.drop / out.hours : null;
  for (const m of Object.values(out.modes)) m.perHour = m.h > 0.25 ? m.drop / m.h : null;
  return out;
}

export function startBarometer() {}
export function stopBarometer() {}
export const pressure = () => null;
