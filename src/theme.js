// Görsel dil: AÇIK tema — beyaz paneller, açık gri zemin, TEK vurgu rengi; ulaşım türleri kendi anlam renginde.
export const C = {
  bg: '#F4F5F7', panel: '#FFFFFF', panel2: '#EEF1F4', line: '#DCE1E7',
  text: '#111820', dim: '#5B6873', faint: '#A7B0BA',
  accent: '#0A84A8', ok: '#2DA44E', warn: '#BF8700', bad: '#D1242F',
  onAccent: '#FFFFFF', // vurgu rengi üstündeki yazı
};

// Tür -> etiket, renk, ikon (MaterialCommunityIcons)
export const MODE = {
  walk: { label: 'Yaya', color: '#2DA44E', icon: 'walk' },
  bike: { label: 'Bisiklet', color: '#BF8700', icon: 'bike' },
  bus: { label: 'Otobüs', color: '#D4570B', icon: 'bus' },
  car: { label: 'Araba', color: '#1F6FEB', icon: 'car' },
  metro: { label: 'Metro', color: '#8250DF', icon: 'subway-variant' },
};

// Haritada çizgi renkleri: türler + 'raw' (ham iz — türü belirlenmemiş her hareket)
export const LINE = { ...MODE, raw: { color: '#5B6873' } };

const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const GUN = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const p2 = (n) => String(n).padStart(2, '0');

// Biçimlendirme (Intl kullanılmaz: Hermes'te yerel ayar desteği güvenilir değil)
export const fmtClock = (t) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
export const fmtClockS = (t) => fmtClock(t) + ':' + p2(new Date(t).getSeconds());
export const fmtMin = (m) => p2(Math.floor(m / 60)) + ':' + p2(m % 60);
export const fmtDay = (t) => { const d = new Date(t); return d.getDate() + ' ' + AY[d.getMonth()] + ' ' + GUN[d.getDay()]; };
export const fmtDayShort = (t) => GUN[new Date(t).getDay()];
export const fmtDate = (t) => { const d = new Date(t); return d.getDate() + ' ' + AY[d.getMonth()]; };
export function fmtDur(ms) {
  const m = Math.round(ms / 60e3);
  if (m < 60) return m + ' dk';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + ' sa ' + r + ' dk' : h + ' sa';
}
// Kısa süreler saniyeli: 45 sn · 1 dk 20 sn · 12 dk (bekleme süreleri için)
export function fmtDurS(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec + ' sn';
  if (sec < 600) return Math.floor(sec / 60) + ' dk' + (sec % 60 ? ' ' + (sec % 60) + ' sn' : '');
  return fmtDur(ms);
}
export const fmtKm = (m) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km');
export const fmtKmh = (ms) => Math.round(ms * 3.6) + ' km/s';
export const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // 12 345
