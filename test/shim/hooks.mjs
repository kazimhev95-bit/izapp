// Node yükleyici kancaları: uygulama kodunu (src/store.js, src/sync.js) telefonsuz çalıştırmak için Expo / RN
// modüllerini test/shim altındaki sahteleriyle değiştirir, uzantısız göreli yolları .js'e çözer.
const SHIM = { 'expo-sqlite': 'expo-sqlite.mjs', 'react-native': 'react-native.mjs', 'expo-secure-store': 'secure-store.mjs', 'expo-network': 'network.mjs', 'expo-crypto': 'crypto.mjs' };
export async function resolve(spec, ctx, next) {
  if (SHIM[spec]) return { url: new URL(SHIM[spec], import.meta.url).href, shortCircuit: true, format: 'module' };
  if (spec.startsWith('.') && !/\.[cm]?js$|\.json$/.test(spec)) return next(spec + '.js', ctx);
  return next(spec, ctx);
}
// src/*.js ESM sözdizimli ama package.json'da "type" yok: modül olarak yükle
export async function load(url, ctx, next) {
  if (url.includes('/src/') && url.endsWith('.js')) return next(url, { ...ctx, format: 'module' });
  return next(url, ctx);
}
