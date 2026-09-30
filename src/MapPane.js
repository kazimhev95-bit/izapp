// Harita (telefon): mapHtml.js sayfasını WebView içinde gösterir. Web eşdeğeri: MapPane.web.js.
// props: legs [{mode, coords:[{latitude,longitude}]}], stays [{key,lat,lon,...}], fitKey, live, pad
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { MODE } from './theme';
import { MAP_HTML, mapPayload } from './mapHtml';

export default function MapPane(props) {
  const { legs, stays, fitKey, onStayPress } = props;
  const ref = useRef(null), lastFit = useRef(null);
  const [ready, setReady] = useState(false);

  // Veri değişince haritaya gönder. Rotaya yeniden odaklanma yalnız fitKey (gün/yolculuk)
  // değişince yapılır — yoksa kullanıcı haritayı kaydırırken 30 sn'de bir geri zıplar.
  useEffect(() => {
    if (!ready || !ref.current) return;
    const fit = lastFit.current !== fitKey;
    lastFit.current = fitKey;
    ref.current.injectJavaScript('window.izSet(' + JSON.stringify(mapPayload(props, MODE, fit)) + ');true;');
  }, [ready, legs, stays, fitKey]);

  const onMessage = (e) => {
    let m; try { m = JSON.parse(e.nativeEvent.data); } catch (x) { return; }
    if (m.ready) setReady(true);
    if (m.stay && onStayPress) { const s = stays.find((x) => x.key === m.stay); if (s) onStayPress(s); }
  };

  return (
    <WebView
      ref={ref} style={[StyleSheet.absoluteFill, { backgroundColor: '#F4F5F7' }]}
      originWhitelist={['*']} source={{ html: MAP_HTML, baseUrl: 'https://izapp.local/' }} // baseUrl: karo sunucusu Referer ister
      onMessage={onMessage} javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false}
      onContentProcessDidTerminate={() => { setReady(false); lastFit.current = null; ref.current && ref.current.reload(); }}
    />
  );
}
