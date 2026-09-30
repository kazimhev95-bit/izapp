// Web önizlemesi: adım sayısı ve dışa aktarma gerçek değil — arayüzü görmek için sahte değerler.
export async function stepsBetween(a, b) {
  if (b <= a) return null;
  const min = (b - a) / 60e3;
  return min > 360 ? 7400 : Math.round(min * 105); // uzun aralık: günlük toplam; kısa: ~105 adım/dk
}
export async function askMotion() { return true; }
export async function exportData() { return 0; }
// Önizlemede GPX dosyası tarayıcıya indirilir (telefonda paylaşım penceresi açılır)
export async function exportGpx(trip, name) {
  const pts = (trip.raw || trip.pts).filter((q) => !q.syn);
  const body = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="IZ" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>' + String(name).replace(/[<&>"]/g, '') + '</name><trkseg>' + pts.map((q) => '<trkpt lat="' + q.lat.toFixed(6) + '" lon="' + q.lon.toFixed(6) + '"><time>' + new Date(q.t).toISOString() + '</time></trkpt>').join('') + '</trkseg></trk></gpx>';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/gpx+xml' }));
  a.download = 'iz-yolculuk.gpx'; a.click();
  return pts.length;
}
