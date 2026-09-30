// Harita (web önizleme): telefondaki ile AYNI sayfayı (mapHtml.js) iframe içinde gösterir.
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { MODE } from './theme';
import { MAP_HTML, mapPayload } from './mapHtml';

export default function MapPane(props) {
  const { legs, stays, fitKey, onStayPress } = props;
  const ref = useRef(null), lastFit = useRef(null), live = useRef(props);
  const [ready, setReady] = useState(false);
  live.current = props;

  // Harita sayfasından gelen mesajlar (hazır / durağa dokunuldu)
  useEffect(() => {
    const h = (e) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.ready) setReady(true);
      if (m.stay && live.current.onStayPress) { const s = live.current.stays.find((x) => x.key === m.stay); if (s) live.current.onStayPress(s); }
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);

  useEffect(() => {
    if (!ready || !ref.current) return;
    const fit = lastFit.current !== fitKey;
    lastFit.current = fitKey;
    ref.current.contentWindow.postMessage(JSON.stringify(mapPayload(props, MODE, fit)), '*');
  }, [ready, legs, stays, fitKey]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0B0F13' }]}>
      <iframe ref={ref} srcDoc={MAP_HTML} title="harita" style={{ border: 0, width: '100%', height: '100%' }} />
    </View>
  );
}
