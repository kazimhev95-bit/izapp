// Web önizlemesi: gerçek konum kaydı yok, yalnız arayüzün çalışması için sahte durum.
let running = true;
export async function status() { return { fg: true, bg: true, canAskBg: true, running }; }
export async function start() { running = true; return status(); }
export async function stop() { running = false; return status(); }
export async function geocode() { return null; }
