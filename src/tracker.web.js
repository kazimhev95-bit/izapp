// Web önizlemesi: gerçek konum kaydı yok, yalnız arayüzün çalışması için sahte durum.
let running = true;
export async function status() { return { fg: true, bg: true, canAskBg: true, running }; }
export async function start() { running = true; return status(); }
export async function stop() { running = false; return status(); }
export async function geocode() { return null; }
// Önizlemede tarayıcının konumu (izin verilirse) canlı nokta olarak gösterilir.
export function watch(cb) {
  if (!navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition((p) => cb({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), () => {}, { enableHighAccuracy: true });
  return () => navigator.geolocation.clearWatch(id);
}
