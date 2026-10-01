// Web önizlemesi: gerçek sunucu aktarımı yok (tarayıcıda Anahtarlık / arka plan yok). pro.web.js gibi, Ayarlar
// kartı görülebilsin diye sync.js ile aynı imzalar ve sahte değerler.
import { getKV, setKV, pointStats } from './store';

export const available = () => true;
export const enabled = () => getKV('sync', true);
export function setEnabled(on) { setKV('sync', !!on); }
export const status = { at: Date.now() - 40e3, net: 'wifi', sent: 12, err: null, busy: false };
export async function tick() { status.at = Date.now(); }
export const pending = () => ({ p: 3, a: 1, b: 0, l: 2 });
export async function serverInfo() { const s = pointStats(); return { n: { p: s.n, a: 640, b: 48, l: 210, m: 3 }, first: s.first, last: s.last }; }
export async function wipeServer() { return 0; }
export const deviceId = () => 'a5bb7e11';
