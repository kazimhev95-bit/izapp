// Web önizlemesi için basit SVG harita (gerçek harita karoları yok; yalnız rota + duraklar).
// props MapPane.js ile aynı.
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line } from 'react-native-svg';
import { C, MODE } from './theme';

export default function MapPane({ legs, stays, pad, onStayPress }) {
  const P = pad || { top: 120, right: 50, bottom: 260, left: 50 };
  const [box, setBox] = useState({ w: 0, h: 0 });
  const all = [];
  legs.forEach((l) => l.coords.forEach((c) => all.push([c.longitude, c.latitude])));
  stays.forEach((s) => all.push([s.lon, s.lat]));
  let body = null;
  if (all.length && box.w) {
    const xs = all.map((a) => a[0]), ys = all.map((a) => a[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180); // boylam sıkışması
    const W = box.w - P.left - P.right, H = box.h - P.top - P.bottom;
    const sc = Math.min(W / Math.max((x1 - x0) * k, 1e-4), H / Math.max(y1 - y0, 1e-4));
    const X = (lon) => P.left + (W - (x1 - x0) * k * sc) / 2 + (lon - x0) * k * sc;
    const Y = (lat) => P.top + (H - (y1 - y0) * sc) / 2 + (y1 - lat) * sc;
    body = (
      <>
        {legs.map((l, i) => (
          <Polyline key={i} points={l.coords.map((c) => X(c.longitude) + ',' + Y(c.latitude)).join(' ')} fill="none"
            stroke={MODE[l.mode].color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.mode === 'metro' ? '8 8' : undefined} />
        ))}
        {stays.map((s) => (
          <Circle key={s.key} cx={X(s.lon)} cy={Y(s.lat)} r={10} fill={C.panel} stroke={C.accent} strokeWidth={2} onPress={() => onStayPress && onStayPress(s)} />
        ))}
      </>
    );
  }
  const grid = [];
  for (let x = 0; x < box.w; x += 48) grid.push(<Line key={'x' + x} x1={x} y1={0} x2={x} y2={box.h} stroke={C.line} strokeWidth={0.5} />);
  for (let y = 0; y < box.h; y += 48) grid.push(<Line key={'y' + y} x1={0} y1={y} x2={box.w} y2={y} stroke={C.line} strokeWidth={0.5} />);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0B0F13' }]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Svg width={box.w} height={box.h}>{grid}{body}</Svg>
    </View>
  );
}
