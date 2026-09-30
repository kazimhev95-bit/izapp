// Web önizlemesi: gerçek konum kaydı yok, yalnız arayüzün çalışması için sahte durum.
let running = true;
export async function status() { return { fg: true, bg: true, canAskBg: true, running }; }
export async function start() { running = true; return status(); }
export async function stop() { running = false; return status(); }
export async function geocode() { return null; }
export const testMode = () => null;
export async function diag(test) {
  return { services: true, fg: 'granted / always', bg: 'granted', registered: true, started: running, stats: {}, test: test ? 'önizlemede yok' : undefined };
}
// Önizlemede tarayıcının konumu (izin verilirse) canlı nokta olarak gösterilir.
export function watch(cb) {
  if (!navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition((p) => cb({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, spd: p.coords.speed, t: p.timestamp }), () => {}, { enableHighAccuracy: true });
  return () => navigator.geolocation.clearWatch(id);
}
