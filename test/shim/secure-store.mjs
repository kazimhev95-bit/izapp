// iOS Anahtarlık yerine bellek. globalThis.__ss ile testten okunur/bozulur.
const m = (globalThis.__ss = globalThis.__ss || new Map());
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'afu-tdo';
export async function getItemAsync(k, o) { if (globalThis.__ssFail) throw new Error('kilitli'); globalThis.__ssOpt = o; return m.has(k) ? m.get(k) : null; }
export async function setItemAsync(k, v, o) { globalThis.__ssOpt = o; m.set(k, v); }
export async function deleteItemAsync(k) { m.delete(k); }
