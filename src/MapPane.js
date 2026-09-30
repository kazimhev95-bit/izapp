// Harita (iOS: Apple Haritalar — anahtar/hesap gerektirmez). Web eşdeğeri: MapPane.web.js.
// props: legs [{mode, coords:[{latitude,longitude}]}], stays [{key,lat,lon,kind,label}], fitKey, live
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { Feather } from '@expo/vector-icons';
import { C, MODE } from './theme';

const KIND_ICON = { home: 'home', work: 'briefcase' };

export default function MapPane({ legs, stays, fitKey, live, pad, onStayPress }) {
  const ref = useRef(null);
  // fitKey değişince (gün/yolculuk değişti) tüm rotayı ekrana sığdır. Veri yenilenince DEĞİL —
  // yoksa kullanıcı haritayı kaydırırken 30 sn'de bir geri zıplar.
  useEffect(() => {
    const all = [];
    legs.forEach((l) => all.push(...l.coords));
    stays.forEach((s) => all.push({ latitude: s.lat, longitude: s.lon }));
    if (!all.length || !ref.current) return;
    const t = setTimeout(() => {
      ref.current && ref.current.fitToCoordinates(all, { edgePadding: pad || { top: 120, right: 50, bottom: 260, left: 50 }, animated: true });
    }, 350); // harita ilk çizimini bitirsin
    return () => clearTimeout(t);
  }, [fitKey]);

  return (
    <MapView
      ref={ref} style={StyleSheet.absoluteFill} userInterfaceStyle="dark"
      showsUserLocation={!!live} showsCompass={false} showsPointsOfInterest={false} pitchEnabled={false}
      initialRegion={{ latitude: 40.4093, longitude: 49.8671, latitudeDelta: 0.12, longitudeDelta: 0.12 }}
    >
      {legs.map((l, i) => (
        <Polyline
          key={fitKey + '-' + i + '-' + l.mode + '-' + l.coords.length} coordinates={l.coords}
          strokeColor={MODE[l.mode].color} strokeWidth={4} lineCap="round" lineJoin="round"
          lineDashPattern={l.mode === 'metro' ? [8, 8] : undefined} // metro: GPS yok, düz çizgi tahmindir
        />
      ))}
      {stays.map((s) => (
        <Marker
          key={s.key} coordinate={{ latitude: s.lat, longitude: s.lon }} anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false} onPress={() => onStayPress && onStayPress(s)}
        >
          <View style={st.pin}><Feather name={KIND_ICON[s.kind] || 'map-pin'} size={13} color={C.text} /></View>
        </Marker>
      ))}
    </MapView>
  );
}

const st = StyleSheet.create({
  pin: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.panel, borderWidth: 2, borderColor: C.accent, alignItems: 'center', justifyContent: 'center' },
});
