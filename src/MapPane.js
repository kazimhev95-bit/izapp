// Harita (telefon): mapHtml.js sayfasını WebView içinde gösterir. Web eşdeğeri: MapPane.web.js.
// props: legs [{mode, coords:[{latitude,longitude}]}], stays [{key,lat,lon,...}], fitKey, live, pad
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { LINE } from './theme';
import { MAP_HTML, mapPayload } from './mapHtml';
import * as store from './store';
import { offlineOn } from './offline';

export default function MapPane(props) {
  const { legs, stays, fitKey, onStayPress, me, centerTick, follow } = props;
  const ref = useRef(null), lastFit = useRef(null);
  const [ready, setReady] = useState(false);

  // Veri değişince haritaya gönder. Rotaya yeniden odaklanma yalnız fitKey (gün/yolculuk)
  // değişince yapılır — yoksa kullanıcı haritayı kaydırırken 30 sn'de bir geri zıplar.
  useEffect(() => {
    if (!ready || !ref.current) return;
    const fit = lastFit.current !== fitKey;
    lastFit.current = fitKey;
    ref.current.injectJavaScript('window.izSet(' + JSON.stringify(mapPayload(props, LINE, fit)) + ');true;');
  }, [ready, legs, stays, props.marks, props.dots, props.rings, fitKey]);

  // Hız grafiğinde seçilen an: haritada koyu nokta + saat/hız etiketi
  useEffect(() => {
    if (!ready || !ref.current) return;
    const c = props.cursor;
    ref.current.injectJavaScript('window.izCur(' + JSON.stringify(c ? { pos: [c.lat, c.lon], label: c.label } : {}) + ');true;');
  }, [ready, props.cursor]);

  // Canlı konum: yalnız mavi nokta kayar (rota yeniden çizilmez). Konum düğmesine basılınca
  // (centerTick) ya da gösterilecek rota yokken ilk konum gelince harita oraya ortalanır.
  const lastTick = useRef(centerTick), centered = useRef(false);
  useEffect(() => {
    if (!ready || !ref.current) return;
    if (!me) { ref.current.injectJavaScript('window.izMe({clear:1});true;'); return; }
    const center = lastTick.current !== centerTick || (!centered.current && !legs.length && !stays.length);
    lastTick.current = centerTick; centered.current = true;
    ref.current.injectJavaScript('window.izMe(' + JSON.stringify({ mePos: [me.lat, me.lon], acc: me.acc, center, follow: !!follow }) + ');true;');
  }, [ready, me, centerTick]);

  const onMessage = (e) => {
    let m; try { m = JSON.parse(e.nativeEvent.data); } catch (x) { return; }
    if (m.ready) { setReady(true); ref.current && ref.current.injectJavaScript('window.izOffline(' + (offlineOn() ? 'true' : 'false') + ');true;'); }
    // Çevrimdışı karo: önbellekte varsa base64 gönder, yoksa null (sayfa ağdan yükler)
    if (m.tile) { const b = store.getTile(m.tile); ref.current && ref.current.injectJavaScript('window.izTile(' + JSON.stringify(m.tile) + ',' + (b ? JSON.stringify(b) : 'null') + ');true;'); }
    if (m.drag && props.onUserDrag) props.onUserDrag();
    if (m.trip != null && props.onTripPress) props.onTripPress(m.trip); // parça bilgisindeki "Ayrıntılar"
    if (m.stay && onStayPress) { const s = stays.find((x) => x.key === m.stay); if (s) onStayPress(s); }
  };

  return (
    <WebView
      ref={ref} style={[StyleSheet.absoluteFill, { backgroundColor: '#F4F5F7' }]}
      originWhitelist={['*']} source={{ html: MAP_HTML, baseUrl: 'https://izapp.local/' }} // baseUrl: karo sunucusu Referer ister
      onMessage={onMessage} javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false}
      onContentProcessDidTerminate={() => { setReady(false); lastFit.current = null; centered.current = false; ref.current && ref.current.reload(); }}
    />
  );
}
