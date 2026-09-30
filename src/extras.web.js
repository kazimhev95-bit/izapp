// Web önizlemesi: adım sayısı ve dışa aktarma gerçek değil — arayüzü görmek için sahte değerler.
export async function stepsBetween(a, b) {
  if (b <= a) return null;
  const min = (b - a) / 60e3;
  return min > 360 ? 7400 : Math.round(min * 105); // uzun aralık: günlük toplam; kısa: ~105 adım/dk
}
export async function askMotion() { return true; }
export async function exportData() { return 0; }
