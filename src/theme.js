// Görsel dil: koyu grafit zemin, düz paneller, TEK vurgu rengi; ulaşım türleri kendi anlam renginde.
export const C = {
  bg: '#0F1419', panel: '#161D24', panel2: '#1C252E', line: '#26313B',
  text: '#E6EDF3', dim: '#8B98A5', faint: '#5B6873',
  accent: '#2EC4DB', ok: '#3FB950', warn: '#D29922', bad: '#F85149',
};

// Tür -> etiket, renk, ikon (MaterialCommunityIcons)
export const MODE = {
  walk: { label: 'Yaya', color: '#3FB950', icon: 'walk' },
  bike: { label: 'Bisiklet', color: '#D29922', icon: 'bike' },
  car: { label: 'Araba', color: '#2EC4DB', icon: 'car' },
  metro: { label: 'Metro', color: '#A371F7', icon: 'subway-variant' },
};

const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const GUN = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const p2 = (n) => String(n).padStart(2, '0');

// Biçimlendirme (Intl kullanılmaz: Hermes'te yerel ayar desteği güvenilir değil)
export const fmtClock = (t) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
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
export const fmtKm = (m) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km');
export const fmtKmh = (ms) => Math.round(ms * 3.6) + ' km/s';
