// Harita (web önizleme): telefondaki ile AYNI sayfayı (mapHtml.js) iframe içinde gösterir.
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { LINE } from './theme';
import { MAP_HTML, mapPayload } from './mapHtml';
import * as store from './store';
import { offlineOn } from './offline';

export default function MapPane(props) {
  const { legs, stays, fitKey, onStayPress, me, centerTick, follow } = props;
  const ref = useRef(null), lastFit = useRef(null), live = useRef(props);
  const [ready, setReady] = useState(false);
  live.current = props;

  // Harita sayfasından gelen mesajlar (hazır / durağa dokunuldu)
  useEffect(() => {
    const h = (e) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.ready) { setReady(true); ref.current.contentWindow.postMessage(JSON.stringify({ offline: offlineOn() }), '*'); }
      if (m.tile) { const b = store.getTile(m.tile); ref.current.contentWindow.postMessage(JSON.stringify({ tileKey: m.tile, b64: b || null }), '*'); }
      if (m.drag && live.current.onUserDrag) live.current.onUserDrag();
      if (m.trip != null && live.current.onTripPress) live.current.onTripPress(m.trip);
      if (m.stay && live.current.onStayPress) { const s = live.current.stays.find((x) => x.key === m.stay); if (s) live.current.onStayPress(s); }
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);

  useEffect(() => {
    if (!ready || !ref.current) return;
    const fit = lastFit.current !== fitKey;
    lastFit.current = fitKey;
    ref.current.contentWindow.postMessage(JSON.stringify(mapPayload(props, LINE, fit)), '*');
  }, [ready, legs, stays, props.marks, props.dots, props.rings, fitKey]);

  // Hız grafiğinde seçilen an (MapPane.js ile aynı)
  useEffect(() => {
    if (!ready || !ref.current) return;
    const c = props.cursor;
    ref.current.contentWindow.postMessage(JSON.stringify({ cur: c ? { pos: [c.lat, c.lon], label: c.label } : {} }), '*');
  }, [ready, props.cursor]);

  // Canlı konum noktası (MapPane.js ile aynı mantık)
  const lastTick = useRef(centerTick), centered = useRef(false);
  useEffect(() => {
    if (!ready || !ref.current) return;
    if (!me) { ref.current.contentWindow.postMessage(JSON.stringify({ clear: 1 }), '*'); return; }
    const center = lastTick.current !== centerTick || (!centered.current && !legs.length && !stays.length);
    lastTick.current = centerTick; centered.current = true;
    ref.current.contentWindow.postMessage(JSON.stringify({ mePos: [me.lat, me.lon], acc: me.acc, center, follow: !!follow }), '*');
  }, [ready, me, centerTick]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#F4F5F7' }]}>
      <iframe ref={ref} srcDoc={MAP_HTML} title="harita" style={{ border: 0, width: '100%', height: '100%' }} />
    </View>
  );
}
