// İZ — kişisel konum günlüğü. Telefon gittiğin yolu kaydeder; motor (src/engine.js) bunu
// duraklara, yolculuklara, ulaşım türlerine ve rutinlere çevirir. Kayıtlar yalnız cihazda durur; yola
// oturtma için bitmiş yolculuklar kendi sunucumuza sorulur (orada saklanmaz — src/snap.js).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
import MapPane from './src/MapPane';
import * as store from './src/store';
import * as tracker from './src/tracker';
import * as extras from './src/extras';
import * as snap from './src/snap';
import { analyze, dayStart, addDays, hav, MODES } from './src/engine';
import { simplifyIdx } from './src/smooth';
import { C, MODE, fmtClock, fmtClockS, fmtMin, fmtDay, fmtDayShort, fmtDate, fmtDur, fmtDurS, fmtKm, fmtKmh, fmtInt } from './src/theme';

const VERSION = require('./app.json').expo.version;
const TOP = Platform.OS === 'ios' ? 54 : 14;   // çentik payı
const BOTTOM = Platform.OS === 'ios' ? 26 : 8; // ana ekran çizgisi payı
const KIND_ICON = { home: 'home', work: 'briefcase' };
const DP_EPS = 2; // m — çizimde bu kadar sapan ara noktalar atılır (ayrıntı kalsın; zikzağı düzeltme halleder)
const toCoords = (pts) => pts.map((p) => ({ latitude: p.lat, longitude: p.lon }));

// Bir yolculuğun haritada çizilecek çizgileri: parça parça (türe göre renkli), kayıt boşluğu / GPS'siz
// bölümler kesikli. Kayıtlı bölümler sadeleştirilir. Uçlar komşu durağın işaretine bağlanır.
// Yola oturtulmuş parçada (leg.snap) noktalar yolla birleştirilmiş konumdadır ve aralarına yolun köşeleri
// eklenir — çizgi yolu izler ama gerçek izden sapmaz.
// Her çizgi dokununca bilgi verir (info); withTrip: bilgide "Ayrıntılar ›" bağlantısı (yolculuk açılır).
// GPS'i zayıf parça soluk çizilir (weak) — "burası yaklaşık".
function tripLines(trip, withTrip = false) {
  const out = [], pts = trip.pts;
  trip.legs.forEach((leg) => {
    const mode = trip.overridden ? trip.mode : leg.mode;
    const at = (k) => (leg.snap ? leg.snap.pts[k - leg.a] : pts[k]);
    const info = legInfo(trip, leg), weak = !!leg.gps && leg.gps.lvl === 'zayıf' && (!leg.snap || mode === 'walk' || mode === 'bike');
    let start = leg.a;
    for (let k = leg.a; k < leg.b; k++) {
      const dash = !!trip.dash[k];
      if (k + 1 < leg.b && !!trip.dash[k + 1] === dash) continue; // aynı türden devam ediyor
      let piece = [];
      for (let i = start; i <= k + 1; i++) {
        const q = at(i);
        if (i > start && q.via) for (const v of q.via) piece.push({ lat: v[0], lon: v[1] });
        piece.push(q);
      }
      if (!dash && piece.length > 2) piece = simplifyIdx(piece, DP_EPS).map((i) => piece[i]);
      out.push({ mode, dash, weak, info, trip: withTrip ? trip.t0 : null, coords: toCoords(piece) });
      start = k + 1;
    }
  });
  // Parçalar birbirine bağlansın (oturtulmuş parçanın ucu komşusununkinden birkaç metre kayabilir)
  for (let i = 1; i < out.length; i++) { const p = out[i - 1].coords; out[i].coords.unshift(p[p.length - 1]); }
  // Durak işareti yerin merkezinde durur; durağın kendi merkezi ona yakınsa çizgiyi işarete bağla.
  const anchor = (st) => (!st ? null : st.place && hav(st, st.place) <= 80 ? st.place : st);
  const a = anchor(trip.fromStay), b = anchor(trip.toStay);
  if (out.length && a) out[0].coords.unshift({ latitude: a.lat, longitude: a.lon });
  if (out.length && b) out[out.length - 1].coords.push({ latitude: b.lat, longitude: b.lon });
  return out;
}
const stName = (st) => (st && st.place ? st.place.name : null);
// Çizgiye dokununca çıkan bilgi (satırlar). "!" ile başlayan satır uyarı renginde gösterilir.
function legInfo(trip, leg) {
  const mode = trip.overridden ? trip.mode : leg.mode;
  const L = [MODE[mode].label + (leg.est ? ' (tahmini)' : '') + ' · ' + fmtKm(leg.dist) + ' · ' + fmtDur(leg.dur)];
  L.push(fmtClock(leg.t0) + ' – ' + fmtClock(leg.t1) + ' · ort ' + fmtKmh(leg.avg) + (leg.max ? ' · tepe ' + fmtKmh(leg.max) : ''));
  if ((mode === 'bus' || mode === 'car') && leg.stops) L.push(leg.stops + ' duruş (' + fmtDur(leg.stopMs) + ')');
  if ((mode === 'bus' || mode === 'car') && leg.slowMs >= 60e3) L.push('trafikte yavaş (11 km/s altı): ' + fmtDur(leg.slowMs));
  if ((mode === 'bus' || mode === 'car') && leg.atStops != null && leg.stopPts && leg.stopPts.length) L.push('otobüs durağında duruş: ' + leg.atStops + ' / ' + leg.stopPts.length);
  const ws = leg.waits || [];
  if (ws.length) L.push((ws.length > 1 ? ws.length + ' bekleme, toplam ' : 'bekleme ') + fmtDurS(ws.reduce((x, w) => x + (w.t1 - w.t0), 0)));
  if (leg.gps) L.push((leg.gps.lvl === 'zayıf' ? '!' : '') + 'GPS ' + leg.gps.lvl + ' (±' + leg.gps.acc + ' m)' + (leg.gps.lvl === 'zayıf' ? ' — çizgi yaklaşık' : ''));
  if (leg.snap) L.push('Yola oturtuldu (kendi sunucun)');
  if (stName(trip.fromStay) || stName(trip.toStay)) L.push((stName(trip.fromStay) || '…') + ' → ' + (stName(trip.toStay) || '…'));
  return L;
}
// Gerçek iz (turuncu kesik): yola oturtmadan önceki yerel düzeltilmiş çizgi — karşılaştırma katmanı
const tripTrack = (trip) => ({ mode: 'track', coords: toCoords(trip.pts) });
// Doğruluk halkaları: her kayıt noktasında telefonun bildirdiği ±hata
const tripRings = (trip) => (trip.raw || []).filter((q) => !q.syn && q.acc >= 3).map((q) => ({ lat: q.lat, lon: q.lon, acc: q.acc }));

// ---- Olaylar: sistemin yolculuktan "anladığı" anlar ----
const VEH_OFF = { bus: 'Otobüsten indi', car: 'Arabadan indi', metro: 'Metrodan çıktı', bike: 'Bisikletten indi' };
const VEH_ON = { bus: 'Otobüse bindi', car: 'Arabaya bindi', metro: 'Metroya bindi', bike: 'Bisiklete bindi' };
function switchLabel(a, b) {
  if (b === 'walk') return (VEH_OFF[a] || MODE[a].label + ' bitti') + ', yürüyor';
  if (a === 'walk') return VEH_ON[b] || MODE[b].label;
  return MODE[a].label + ' → ' + MODE[b].label;
}
// Beklemenin anlamı parçaya göre: yayada bekleme, araçta ışık/durak/trafik
const waitWhat = (mode) => (mode === 'walk' ? 'yerinde bekledi' : mode === 'bus' ? 'durdu (durak / ışık)' : mode === 'metro' ? 'durdu' : 'durdu (ışık / trafik)');
// Haritadaki olay noktaları: tür değişimi (indi/bindi) ve beklemeler
function tripMarks(trip) {
  const out = [];
  trip.legs.forEach((l, i) => {
    if (i && !trip.overridden) {
      const q = l.snap ? l.snap.pts[0] : trip.pts[l.a];
      out.push({ kind: 'switch', lat: q.lat, lon: q.lon, mode: l.mode, label: fmtClock(l.t0) + ' · ' + switchLabel(trip.legs[i - 1].mode, l.mode) });
    }
    for (const w of l.waits || []) out.push({ kind: 'wait', lat: w.lat, lon: w.lon, label: fmtClock(w.t0) + ' · ' + fmtDurS(w.t1 - w.t0) + ' ' + waitWhat(trip.overridden ? trip.mode : l.mode) });
  });
  return out;
}
// Yolculuğun kayıt noktaları (ham GPS) — bulunduğu parçanın renginde: "nerede gerçekten ölçülmüş"
function tripDots(trip) {
  const out = [];
  trip.legs.forEach((l, li) => {
    const mode = trip.overridden ? trip.mode : l.mode;
    for (let k = l.a + (li ? 1 : 0); k <= l.b; k++) { const q = trip.raw ? trip.raw[k] : trip.pts[k]; if (q && !q.syn) out.push({ lat: q.lat, lon: q.lon, mode, weak: q.acc > 25 }); }
  });
  return out;
}
// Yolculuğun olay listesi (zaman sırasıyla): çıktı → bindi/indi → bekledi → vardı
function tripEvents(trip) {
  const name = (st) => (st && st.place ? st.place.name : null);
  const first = trip.overridden ? trip.mode : trip.legs[0].mode;
  const ev = [{ t: trip.t0, mode: first, text: (first === 'walk' ? 'Yürümeye başladı' : VEH_ON[first] || MODE[first].label) + (name(trip.fromStay) ? ' · ' + name(trip.fromStay) : '') }];
  trip.legs.forEach((l, i) => {
    if (i && !trip.overridden) ev.push({ t: l.t0, mode: l.mode, text: switchLabel(trip.legs[i - 1].mode, l.mode) });
    for (const w of l.waits || []) ev.push({ t: w.t0, wait: true, text: fmtDurS(w.t1 - w.t0) + ' ' + waitWhat(trip.overridden ? trip.mode : l.mode) });
  });
  ev.push({ t: trip.t1, end: true, text: 'Vardı' + (name(trip.toStay) ? ' · ' + name(trip.toStay) : '') });
  return ev.sort((a, b) => a.t - b.t);
}
// Parçadaki beklemelerin kısa özeti (yaya/bisiklet): " · 2 bekleme, 3 dk" ; yoksa sondaki durak beklemesi
function waitTxt(l) {
  if (l.mode !== 'walk' && l.mode !== 'bike') return '';
  const ws = l.waits || [], tot = ws.reduce((x, w) => x + (w.t1 - w.t0), 0);
  if (ws.length) return ' · ' + (ws.length > 1 ? ws.length + ' bekleme, ' : 'bekleme ') + fmtDurS(tot);
  return l.tailWait >= 90e3 ? ' · sonunda ' + fmtDur(l.tailWait) + ' bekleme' : '';
}

// [from,to) aralığını depodan okuyup analiz eder. Gece yarısını aşan duraklar için ±1 gün pay okunur.
function loadRange(from, to, running, hints, detect) {
  const now = Date.now(), a = addDays(from, -1), b = addDays(to, 1);
  // Tek gün: tüm noktalar (harita birebir çizilsin). Uzun dönem: 10 sn'de bir nokta analiz için yeter.
  const step = to - from > 36 * 3600e3 ? 10e3 : 0;
  return analyze(store.getPoints(a, b, step), {
    from, to, saved: store.getPlaces(), overrides: store.getOverrides(), hints, detect, acts: store.getActivity(a, b),
    snapOf: snap.enabled() ? snap.lookup : null, // sunucudan gelmiş yol çizgileri (telefonda saklı)
    busNear: snap.busNear(),                     // otobüs durakları (OSM) — otobüs/araba ayrımı
    now: running && b > now ? now : undefined, // "hâlâ orada" yalnız güncel aralıkta
  });
}

// Gün analizi önbelleği (Analiz sekmesi): her gün TAM çözünürlükte, Günlük ile aynı hesap. Eskiden dönem
// 10 sn'de bir noktayla hesaplanıyordu; seyrek noktada otobüsün tıxacdaki duruşları kayboluyor, otobüs
// "bisiklet + araba" sanılıyordu (30 Eyl). Bir gün ~5 ms; değişmeyen gün yeniden hesaplanmaz.
const dayMemo = new Map();
function dayData(d, running, hints, rev) {
  const live = running && addDays(d, 1) > Date.now();
  const k = rev + '|' + store.rangeVersion(addDays(d, -1), addDays(d, 2)) + '|' + (live ? Math.floor(Date.now() / 60e3) : '') + '|' + JSON.stringify(hints);
  let v = dayMemo.get(d);
  if (!v || v.k !== k) {
    v = { k, r: loadRange(d, addDays(d, 1), running, hints, false) };
    dayMemo.delete(d); dayMemo.set(d, v);
    if (dayMemo.size > 62) dayMemo.delete(dayMemo.keys().next().value); // en çok ~2 aylık gün bellekte
  }
  return v.r;
}

// ===================== Küçük ortak parçalar =====================
// Harita katmanları (turuncu iz / GPS noktaları / doğruluk halkası): seçim telefonda saklanır.
function useLayers(key, def) {
  const [ly, setLy] = useState(() => ({ ...def, ...(store.getKV(key, null) || {}) }));
  const toggle = (k) => setLy((o) => { const n = { ...o, [k]: !o[k] }; store.setKV(key, n); store.addLog('katman', key + ' · ' + k + ' ' + (n[k] ? 'açık' : 'kapalı')); return n; });
  return [ly, toggle];
}
const LAYERS = [['track', 'Turuncu iz', '#FF8A00'], ['dots', 'GPS noktaları', C.dim], ['rings', 'Doğruluk halkası', C.faint]];

function ModeIcon({ mode, size = 16 }) {
  return <MaterialCommunityIcons name={MODE[mode].icon} size={size} color={MODE[mode].color} />;
}

function Card({ title, right, children, style }) {
  return (
    <View style={[s.card, style]}>
      {title ? <View style={s.cardHead}><Text style={s.cardTitle}>{title}</Text>{right}</View> : null}
      {children}
    </View>
  );
}

function Chip({ label, active, onPress, color }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, active && { borderColor: color || C.accent, backgroundColor: C.panel2 }]}>
      <Text style={[s.chipTx, active && { color: color || C.accent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Stat({ label, value }) {
  return <View style={{ flex: 1 }}><Text style={s.statV} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={s.statL}>{label}</Text></View>;
}

// ‹ 30 Eyl Çar ›  — ileri ok bugünden öteye gitmez; etikete dokununca bugüne döner.
function DateBar({ day, setDay }) {
  const today = dayStart(Date.now()), isToday = day >= today;
  return (
    <View style={s.dateBar}>
      <TouchableOpacity style={s.iconBtn} onPress={() => setDay(addDays(day, -1))}><Feather name="chevron-left" size={20} color={C.text} /></TouchableOpacity>
      <TouchableOpacity style={{ flex: 1, alignItems: 'center' }} onPress={() => setDay(today)}>
        <Text style={s.dateTx}>{isToday ? 'Bugün' : fmtDay(day)}</Text>
        {isToday ? <Text style={s.dateSub}>{fmtDay(day)}</Text> : null}
      </TouchableOpacity>
      <TouchableOpacity style={s.iconBtn} disabled={isToday} onPress={() => setDay(addDays(day, 1))}>
        <Feather name="chevron-right" size={20} color={isToday ? C.faint : C.text} />
      </TouchableOpacity>
    </View>
  );
}

// Tür başına km + süre satırı (yalnız kullanılan türler)
function ModeRow({ modes }) {
  const used = MODES.filter((m) => modes[m].dist > 0);
  if (!used.length) return <Text style={s.dim}>Hareket yok</Text>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {used.map((m) => (
        <View key={m} style={s.modeChip}>
          <ModeIcon mode={m} />
          <Text style={s.modeChipTx}>{fmtKm(modes[m].dist)}</Text>
          <Text style={s.dim}>{fmtDur(modes[m].dur)}</Text>
        </View>
      ))}
    </View>
  );
}

// Yolculuğun parçaları tek satırda: [yaya 300 m] [otobüs 5,4 km] [yaya 330 m]
function LegStrip({ trip }) {
  if (trip.overridden || trip.legs.length < 2) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
      {trip.legs.map((l, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <ModeIcon mode={l.mode} size={13} />
          <Text style={s.dim}>{fmtKm(l.dist)}</Text>
        </View>
      ))}
    </View>
  );
}
// Parça sırası: "Yaya → Otobüs → Yaya → Otobüs" (art arda aynı tür tek sayılır)
const seqLabel = (trip) => trip.legs.map((l) => MODE[l.mode].label).filter((x, i, a) => i === 0 || a[i - 1] !== x).join(' → ');
// Araç parçalarındaki toplam duruş sayısı (ışık / durak)
const tripStops = (trip) => trip.legs.reduce((n, l) => n + (l.mode === 'car' || l.mode === 'bus' ? l.stops : 0), 0);

// ===================== HARİTA =====================
// m:ss (canlı bekleme sayacı)
const mmss = (ms) => Math.floor(ms / 60e3) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');

function HaritaTab({ data, day, setDay, trk, onToggle, onPlace, onTrip, me, steps, lastAct }) {
  const [centerTick, setCenterTick] = useState(0);   // konum düğmesine her basışta artar
  const [follow, setFollow] = useState(false);       // takip: harita canlı konumla birlikte kayar
  const [panel, setPanel] = useState(false);         // katman seçim kutusu açık mı
  const [ly, toggleLy] = useLayers('layers_day', { track: false, dots: false, rings: false });
  // Yolculuklar: düzeltilmiş + türe göre renkli (dokununca bilgi + "Ayrıntılar"). Katmanlar isteğe bağlı:
  // turuncu gerçek iz (yola oturtmadan önceki), GPS noktaları, doğruluk halkaları.
  const trips = useMemo(() => data.items.filter((i) => i.type === 'trip'), [data]);
  const lines = useMemo(() => trips.flatMap((t) => tripLines(t, true)), [trips]);
  const legs = useMemo(() => (ly.track ? [...trips.map(tripTrack), ...lines] : lines), [lines, ly.track, trips]);
  const dots = useMemo(() => (ly.dots ? trips.flatMap(tripDots) : null), [ly.dots, trips]);
  const rings = useMemo(() => (ly.rings ? trips.flatMap(tripRings) : null), [ly.rings, trips]);
  const layerOn = ly.track || ly.dots || ly.rings;
  const stays = useMemo(() => data.places.map((p) => ({ key: p.id, lat: p.lat, lon: p.lon, kind: p.kind, place: p })), [data]);
  // Olay noktaları: araçtan indi / bindi, yolda beklemeler (dokununca saat + açıklama)
  const marks = useMemo(() => data.items.filter((i) => i.type === 'trip').flatMap(tripMarks), [data]);
  const t = data.totals;
  // Mavi nokta: canlı konum; o gelmiyorsa en son KAYDEDİLEN nokta (bugün için).
  const isToday = day >= dayStart(Date.now());
  const pos = isToday ? me || (data.lastPt && data.lastPt.t >= day ? data.lastPt : null) : null;
  // Canlı durum — o an ne yapıyorsun: aynı yerde (±15 m) 20 sn'den fazla kaldıysan "Duruyor" + sayaç;
  // değilse hareket algılayıcısı ve hıza göre yürüyor / araçta / bisiklette.
  const [still, setStill] = useState(null); // yerinde durmaya başlanan an ve yer
  useEffect(() => {
    if (!me) { setStill(null); return; }
    setStill((o) => (o && hav(o, me) <= Math.max(15, me.acc || 0) ? o : { lat: me.lat, lon: me.lon, t: me.t || Date.now() }));
  }, [me]);
  let live = null;
  if (me && isToday) {
    const v = me.spd != null && me.spd >= 0 ? me.spd : null, stillMs = still ? Date.now() - still.t : 0;
    if (stillMs >= 20e3 && (v == null || v < 0.8)) live = { icon: 'pause-circle', text: 'Duruyor ' + mmss(stillMs), still: true };
    else if (lastAct === 'A' || (v != null && v >= 7)) live = { icon: 'car', text: 'Araçta' };
    else if (lastAct === 'C') live = { icon: 'bike', text: 'Bisiklette' };
    else if (lastAct === 'W' || lastAct === 'R' || (v != null && v >= 0.5 && v < 2.5)) live = { icon: lastAct === 'R' ? 'run' : 'walk', text: lastAct === 'R' ? 'Koşuyor' : 'Yürüyor' };
  }
  return (
    <View style={{ flex: 1 }}>
      <MapPane legs={legs} stays={stays} marks={marks} dots={dots} rings={rings} fitKey={String(day)} me={pos} centerTick={centerTick} follow={follow && isToday}
        onUserDrag={() => setFollow(false)} onStayPress={(m) => onPlace(m.place)}
        onTripPress={(k) => { const t = trips.find((x) => x.t0 === k); if (t) onTrip(t); }} />
      <View style={[s.overlayTop, { top: TOP }]}>
        <DateBar day={day} setDay={setDay} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <TouchableOpacity style={s.recPill} onPress={onToggle}>
            <View style={[s.dot, { backgroundColor: trk.running ? C.ok : C.bad }]} />
            <Text style={s.recTx}>{trk.running ? 'Kayıt açık' : 'Kayıt kapalı — başlat'}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {/* Canlı durum + anlık hız (GPS'ten). Konum gelmiyorsa nedenini Ayarlar → Tanı gösterir. */}
          <View style={[s.recPill, { marginRight: 8 }]}>
            {live ? <MaterialCommunityIcons name={live.icon} size={14} color={live.still ? C.warn : C.accent} /> : <Feather name="activity" size={13} color={pos ? C.accent : C.faint} />}
            <Text style={s.recTx}>{pos ? (live ? live.text + ' · ' : '') + (live && live.still ? '' : (pos.spd != null ? Math.round(pos.spd * 3.6) + ' km/s · ' : '— km/s · ')) + '±' + Math.round(pos.acc || 0) + ' m' : trk.fg ? 'konum bekleniyor' : 'izin yok'}</Text>
          </View>
          <View style={{ gap: 8 }}>
            {/* Konumuma git + takip: haritayı bulunduğum noktaya ortalar ve ben yürüdükçe birlikte kaydırır.
                Haritayı elle kaydırınca takip bırakılır. */}
            <TouchableOpacity style={[s.locBtn, !pos && { opacity: 0.5 }, follow && { backgroundColor: C.accent, borderColor: C.accent }]} disabled={!pos}
              onPress={() => { setCenterTick(centerTick + 1); setFollow(true); store.addLog('düğme', 'konumuma git + takip'); }}>
              <Feather name="navigation" size={18} color={follow ? C.onAccent : C.accent} />
            </TouchableOpacity>
            {/* Katmanlar: turuncu gerçek iz / GPS noktaları / doğruluk halkası — açıp kapatılır, seçim saklanır */}
            <TouchableOpacity style={[s.locBtn, { marginTop: 0 }, (panel || layerOn) && { borderColor: C.accent }]} onPress={() => setPanel(!panel)}>
              <Feather name="layers" size={18} color={panel || layerOn ? C.accent : C.dim} />
            </TouchableOpacity>
            {panel ? (
              <View style={s.layerPanel}>
                {LAYERS.map(([k, label, col]) => (
                  <TouchableOpacity key={k} style={s.layerRow} onPress={() => toggleLy(k)}>
                    <Feather name={ly[k] ? 'check-square' : 'square'} size={16} color={ly[k] ? C.accent : C.faint} />
                    <View style={[s.layerSw, { backgroundColor: col }]} />
                    <Text style={s.recTx}>{label}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={[s.dim, { fontSize: 10, marginTop: 2 }]}>Çizgiye dokun: parça bilgisi</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      {/* İzin yoksa hiçbir şey kaydedilmez — bunu gizleme, büyük ve net göster. */}
      {!trk.fg ? (
        <TouchableOpacity style={s.permBanner} onPress={onToggle}>
          <Feather name="alert-triangle" size={18} color="#fff" />
          <Text style={s.permTx}>Konum izni yok — kayıt yapılmıyor. İzin vermek için dokun. («Bir Kez» değil, «Uygulamayı Kullanırken» seç; sonra «Her Zaman»a çevir.)</Text>
        </TouchableOpacity>
      ) : null}
      <View style={s.overlayBottom}>
        <View style={s.statRow}>
          <Stat label="Mesafe" value={fmtKm(t.dist)} />
          <Stat label="Yolda" value={fmtDur(t.moveMs)} />
          <Stat label="Durakta" value={fmtDur(t.stayMs)} />
          {steps != null ? <Stat label="Adım" value={fmtInt(steps)} /> : <Stat label="Yer" value={String(data.places.length)} />}
        </View>
        <ModeRow modes={t.modes} />
        {/* Kayıt gerçekten işliyor mu? Nokta sayısı hareket ettikçe artmalı. */}
        <Text style={s.dim}>{data.nPoints} nokta{data.lastT ? ' · son ' + fmtClockS(data.lastT) : ''} · v{VERSION}{layerOn ? ' · katman açık' : ''}</Text>
      </View>
    </View>
  );
}

// ===================== GÜNLÜK (zaman çizelgesi) =====================
// Tasarım: üstte günün 24 saati tek şeritte (bir bakışta: nerede durdun, ne zaman hangi araçla gittin);
// altında akış — solda saat, ortada ikonlu ray, sağda kısa bilgi. Ayrıntı tek dokunuşla (yolculuk sayfası).
function DayStrip({ items, day }) {
  const D = 86400e3, now = Date.now(), pct = (t) => Math.max(0, Math.min(100, ((t - day) / D) * 100));
  const seg = [];
  for (const it of items) {
    if (it.type === 'stay') seg.push({ a: it.t0, b: it.t1, c: it.wait ? '#E3CF9A' : '#CBD3DB' });
    else if (it.type === 'trip') for (const l of it.legs) seg.push({ a: l.t0, b: l.t1, c: MODE[it.overridden ? it.mode : l.mode].color });
  }
  return (
    <View style={{ marginTop: 12 }}>
      <View style={s.strip}>
        {seg.map((x, i) => { const L = pct(x.a); return <View key={i} style={[s.stripSeg, { left: L + '%', width: Math.max(0.7, pct(x.b) - L) + '%', backgroundColor: x.c }]} />; })}
        {now > day && now < day + D ? <View style={[s.stripNow, { left: pct(now) + '%' }]} /> : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
        {['00', '06', '12', '18', '24'].map((h) => <Text key={h} style={s.axis}>{h}</Text>)}
      </View>
    </View>
  );
}
// Yolculuğun parçaları, süreleriyle orantılı renkli çubuk
function LegBar({ trip }) {
  const legs = trip.overridden ? [{ mode: trip.mode, dur: trip.dur }] : trip.legs;
  return <View style={s.legBar}>{legs.map((l, i) => <View key={i} style={{ flex: Math.max(l.dur, 1), backgroundColor: MODE[l.mode].color }} />)}</View>;
}
// Akış satırı: saat | ikonlu ray (satırlar arası çizgiyle bağlı) | içerik | sağda süre
function TLRow({ time, icon, color, last, onPress, children, right }) {
  return (
    <TouchableOpacity activeOpacity={0.6} disabled={!onPress} onPress={onPress} style={s.tlRow}>
      <Text style={s.tlTime}>{time}</Text>
      <View style={s.tlRail}>
        <View style={[s.tlDot, { borderColor: color }]}>{icon}</View>
        {!last ? <View style={s.tlLine} /> : null}
      </View>
      <View style={s.tlBody}>{children}</View>
      {right ? <View style={s.tlRight}>{right}</View> : null}
    </TouchableOpacity>
  );
}
function GunlukTab({ data, day, setDay, onTrip, onPlace, steps }) {
  const now = Date.now();
  const dayPlaces = data.places.filter((p) => p.total > 0), maxPlace = Math.max(1, ...dayPlaces.map((p) => p.total));
  const items = useMemo(() => [...data.items].reverse(), [data]); // yeniden eskiye
  const t = data.totals;
  return (
    <View style={{ flex: 1, paddingTop: TOP }}>
      <View style={{ paddingHorizontal: 14 }}><DateBar day={day} setDay={setDay} /></View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
        <Card>
          <View style={s.statRow}>
            <Stat label="Mesafe" value={fmtKm(t.dist)} />
            <Stat label="Yolda" value={fmtDur(t.moveMs)} />
            <Stat label="Yolculuk" value={String(t.trips)} />
            <Stat label="Adım" value={steps != null ? fmtInt(steps) : '—'} />
          </View>
          <DayStrip items={data.items} day={day} />
          <View style={{ marginTop: 10 }}><ModeRow modes={t.modes} /></View>
        </Card>
        <Card title="GÜN AKIŞI">
          {items.length ? items.map((it, i) => {
            const last = i === items.length - 1;
            if (it.type === 'stay') return (
              <TLRow key={i} last={last} time={fmtClock(it.t0)} color={it.wait ? C.warn : C.accent} onPress={() => onPlace(it.place)}
                icon={<Feather name={it.wait ? 'clock' : KIND_ICON[it.place.kind] || 'map-pin'} size={14} color={it.wait ? C.warn : C.accent} />}
                right={<Text style={s.num}>{fmtDur(it.t1 - it.t0)}</Text>}>
                <Text style={s.tlTitle} numberOfLines={1}>{it.wait ? 'Durakta bekleme' : it.place.name}</Text>
                <Text style={s.dim}>{fmtClock(it.t0)} – {now - it.t1 < 60e3 ? 'şimdi' : fmtClock(it.t1)}{it.wait ? ' · ' + it.place.name : ''}</Text>
              </TLRow>
            );
            if (it.type === 'gap') return (
              <TLRow key={i} last={last} time={fmtClock(it.t0)} color={C.line} icon={<Feather name="slash" size={13} color={C.faint} />}>
                <Text style={s.dim}>Veri yok · {fmtClock(it.t0)} – {fmtClock(it.t1)}</Text>
              </TLRow>
            );
            // Yolculuk: nereden → nereye, parça simgeleri + mesafeleri, orantılı renk çubuğu, kısa not
            const legsV = it.overridden ? [{ mode: it.mode, dist: it.dist }] : it.legs;
            const waits = it.legs.reduce((n, l) => n + (l.waits ? l.waits.length : 0), 0), st = tripStops(it);
            const weak = it.legs.some((l) => l.gps && l.gps.lvl === 'zayıf');
            const title = stName(it.fromStay) && stName(it.toStay) ? stName(it.fromStay) + ' → ' + stName(it.toStay) : MODE[it.mode].label;
            const note = [waits ? waits + ' bekleme' : '', st ? st + ' duruş' : '', weak ? 'GPS zayıf yer var' : ''].filter(Boolean).join(' · ');
            return (
              <TLRow key={i} last={last} time={fmtClock(it.t0)} color={MODE[it.mode].color} onPress={() => onTrip(it)}
                icon={<ModeIcon mode={it.mode} size={15} />}
                right={<View style={{ alignItems: 'flex-end' }}><Text style={s.num}>{fmtDur(it.dur)}</Text><Feather name="chevron-right" size={15} color={C.faint} /></View>}>
                <Text style={s.tlTitle} numberOfLines={1}>{title}</Text>
                <View style={s.legChips}>
                  {legsV.map((l, k) => (
                    <View key={k} style={s.legChip}>
                      {k ? <Feather name="chevron-right" size={11} color={C.faint} /> : null}
                      <ModeIcon mode={l.mode} size={13} />
                      <Text style={s.legChipTx}>{fmtKm(l.dist)}</Text>
                    </View>
                  ))}
                </View>
                <LegBar trip={it} />
                <Text style={[s.dim, { marginTop: 4 }]}>{fmtClock(it.t0)} – {fmtClock(it.t1)} · {fmtKm(it.dist)} · ort {fmtKmh(it.avg)}{note ? ' · ' + note : ''}</Text>
              </TLRow>
            );
          }) : <Text style={s.dim}>Bu gün için kayıt yok</Text>}
        </Card>
        <Card title="NEREDE NE KADAR">
          {dayPlaces.length ? dayPlaces.map((p) => (
            <TouchableOpacity key={p.id} style={{ paddingVertical: 6 }} onPress={() => onPlace(p)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name={KIND_ICON[p.kind] || 'map-pin'} size={15} color={C.accent} />
                <Text style={[s.tx, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
                <Text style={s.dim}>{p.visits > 1 ? p.visits + ' kez' : ''}</Text>
                <Text style={[s.num, { minWidth: 70, textAlign: 'right' }]}>{fmtDur(p.total)}</Text>
              </View>
              <View style={s.barBg}><View style={[s.barFg, { width: (p.total / maxPlace) * 100 + '%' }]} /></View>
            </TouchableOpacity>
          )) : <Text style={s.dim}>Bu gün için kayıt yok</Text>}
        </Card>
      </ScrollView>
    </View>
  );
}

// ===================== ANALİZ (hafta / ay) =====================
// Gün başına türlere göre yolda geçen süre — yığılmış çubuk.
function ModeBars({ days, width }) {
  const H = 120, gap = days.length > 10 ? 2 : 8, bw = (width - gap * (days.length - 1)) / days.length;
  const max = Math.max(60e3, ...days.map((d) => d.moveMs));
  return (
    <View>
      <Svg width={width} height={H}>
        {days.map((d, i) => {
          let y = H;
          return MODES.map((m) => {
            const h = (d.modes[m].dur / max) * (H - 4);
            if (h <= 0) return null;
            y -= h;
            return <Rect key={i + m} x={i * (bw + gap)} y={y} width={bw} height={h} fill={MODE[m].color} />;
          });
        })}
        <Rect x={0} y={H - 1} width={width} height={1} fill={C.line} />
      </Svg>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        {days.map((d, i) => (
          <Text key={i} style={[s.axis, { width: bw + gap }]} numberOfLines={1}>
            {days.length <= 10 ? fmtDayShort(d.day) : i % 5 === 0 ? String(new Date(d.day).getDate()) : ''}
          </Text>
        ))}
      </View>
      <Text style={[s.dim, { marginTop: 4 }]}>En yoğun gün: {fmtDur(max)} yolda</Text>
    </View>
  );
}

function AnalizTab({ trk, hints, rev, onPlace, onTrip, onSnap }) {
  const [span, setSpan] = useState(7);
  const [off, setOff] = useState(0); // kaç dönem geriye
  const [open, setOpen] = useState(null); // açık rutin
  const [w, setW] = useState(0);
  const to = addDays(dayStart(Date.now()), 1 - off * span), from = addDays(to, -span);
  // Yerler + rutinler tüm dönemden (seyrek nokta yeter); yolculuklar, türler ve gün çubukları gün gün tam
  // çözünürlükte (dayData) — Günlük ile birebir aynı sonuç.
  const data = useMemo(() => {
    const base = loadRange(from, to, trk.running, hints, true);
    // Günlerin ev/iş ipucu: dönemin kendi bulduğu ev/iş (yer adları dönemle tutarlı olsun)
    const pick = (k) => { const x = base.places.find((q) => q.kind === k); return x ? { lat: x.lat, lon: x.lon } : (hints && hints[k]) || null; };
    const h2 = { home: pick('home'), work: pick('work') }, ds = [];
    for (let d = from; d < to; d = addDays(d, 1)) ds.push(dayData(d, trk.running, h2, rev));
    const trips = ds.flatMap((x) => x.items.filter((i) => i.type === 'trip'));
    const totals = { ...base.totals, modes: Object.fromEntries(MODES.map((m) => [m, { dist: 0, dur: 0 }])), dist: 0, moveMs: 0, trips: 0 };
    ds.forEach((x, i) => {
      const D = base.days[i];
      if (D) { D.modes = x.totals.modes; D.dist = x.totals.dist; D.moveMs = x.totals.moveMs; }
      totals.dist += x.totals.dist; totals.moveMs += x.totals.moveMs; totals.trips += x.totals.trips;
      for (const m of MODES) { totals.modes[m].dist += x.totals.modes[m].dist; totals.modes[m].dur += x.totals.modes[m].dur; }
    });
    // Rutinin türü: o yolculukların tam çözünürlükteki türü (en çok tekrarlanan)
    for (const r of base.routines) {
      const cnt = {};
      for (const j of r.list) {
        const md = {};
        for (const t of trips) if (t.t0 < j.arr && t.t1 > j.dep) md[t.mode] = (md[t.mode] || 0) + t.dist;
        const top = Object.keys(md).sort((a, b) => md[b] - md[a])[0];
        if (top) cnt[top] = (cnt[top] || 0) + 1;
      }
      r.mode = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || r.mode;
    }
    return { ...base, trips, totals };
  }, [from, to, rev, trk.running]);
  // Dönemin bitmiş parçalarını sunucuya sor (önbellekte olmayanlar); yeni sonuç gelince yenile
  useEffect(() => { snap.fill(data.trips).then((got) => got && onSnap()); }, [data]);
  const t = data.totals, maxPlace = Math.max(1, ...data.places.map((p) => p.total));
  // Harita: dönemdeki tüm yolculuklar (türe göre renkli) + gidilen yerler.
  const legs = useMemo(() => data.trips.flatMap((x) => tripLines(x, true)), [data]);
  const stays = useMemo(() => data.places.map((p) => ({ key: p.id, lat: p.lat, lon: p.lon, kind: p.kind, place: p })), [data]);
  // Yolculuk listesi: nereden → nereye, en yeni üstte.
  const trips = useMemo(() => [...data.trips].reverse(), [data]);
  const nm = (st) => stName(st) || '…';
  return (
    <View style={{ flex: 1, paddingTop: TOP }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 }}>
        <Chip label="7 gün" active={span === 7} onPress={() => { setSpan(7); setOff(0); }} />
        <Chip label="30 gün" active={span === 30} onPress={() => { setSpan(30); setOff(0); }} />
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={s.iconBtn} onPress={() => setOff(off + 1)}><Feather name="chevron-left" size={20} color={C.text} /></TouchableOpacity>
        <Text style={s.tx}>{fmtDate(from)} – {fmtDate(addDays(to, -1))}</Text>
        <TouchableOpacity style={s.iconBtn} disabled={!off} onPress={() => setOff(off - 1)}><Feather name="chevron-right" size={20} color={off ? C.text : C.faint} /></TouchableOpacity>
      </View>
      <View style={s.anMap}>
        <MapPane legs={legs} stays={stays} fitKey={'an' + from + '-' + to} pad={{ top: 24, right: 24, bottom: 24, left: 24 }} onStayPress={(m) => onPlace(m.place)}
          onTripPress={(k) => { const x = trips.find((y) => y.t0 === k); if (x) onTrip(x); }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
        <Card title="YOLCULUKLAR">
          {trips.length ? trips.slice(0, 40).map((trip, i) => (
            <TouchableOpacity key={i} style={s.tl} onPress={() => onTrip(trip)}>
              <View style={[s.tlIcon, { borderColor: MODE[trip.mode].color }]}><ModeIcon mode={trip.mode} size={15} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.tx} numberOfLines={1}>{nm(trip.fromStay)} → {nm(trip.toStay)}</Text>
                <Text style={s.dim}>{fmtDay(trip.t0)} · {fmtClock(trip.t0)} – {fmtClock(trip.t1)} · {fmtKm(trip.dist)}</Text>
                <LegStrip trip={trip} />
              </View>
              <Text style={s.num}>{fmtDur(trip.dur)}</Text>
              <Feather name="chevron-right" size={16} color={C.faint} />
            </TouchableOpacity>
          )) : <Text style={s.dim}>Bu dönemde yolculuk yok</Text>}
        </Card>
        <Card title="ÖZET">
          <View style={s.statRow}>
            <Stat label="Toplam yol" value={fmtKm(t.dist)} />
            <Stat label="Yolda" value={fmtDur(t.moveMs)} />
            <Stat label="Yolculuk" value={String(t.trips)} />
            <Stat label="Günlük ort." value={fmtKm(t.dist / span)} />
          </View>
        </Card>

        <Card title="ULAŞIM TÜRLERİ">
          <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>{w > 0 ? <ModeBars days={data.days} width={w} /> : null}</View>
          <View style={{ marginTop: 10 }}>
            {MODES.filter((m) => t.modes[m].dist > 0).map((m) => (
              <View key={m} style={s.row}>
                <ModeIcon mode={m} />
                <Text style={[s.tx, { flex: 1 }]}>{MODE[m].label}</Text>
                <Text style={s.dim}>ort {fmtKmh(t.modes[m].dist / (t.modes[m].dur / 1000))}</Text>
                <Text style={[s.num, { width: 64, textAlign: 'right' }]}>{fmtKm(t.modes[m].dist)}</Text>
                <Text style={[s.num, { width: 78, textAlign: 'right' }]}>{fmtDur(t.modes[m].dur)}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card title="YERLER">
          {data.places.length ? data.places.slice(0, 12).map((p) => (
            <TouchableOpacity key={p.id} style={{ paddingVertical: 7 }} onPress={() => onPlace(p)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name={KIND_ICON[p.kind] || 'map-pin'} size={15} color={C.accent} />
                <Text style={[s.tx, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
                <Text style={s.num}>{fmtDur(p.total)}</Text>
              </View>
              <View style={s.barBg}><View style={[s.barFg, { width: (p.total / maxPlace) * 100 + '%' }]} /></View>
              <Text style={s.dim}>{p.visits} ziyaret · {p.days} gün · gittiğin gün ort. {fmtDur(p.total / p.days)}</Text>
            </TouchableOpacity>
          )) : <Text style={s.dim}>Bu dönemde kayıt yok</Text>}
        </Card>

        <Card title="RUTİNLER">
          {data.routines.length ? data.routines.map((r, i) => (
            <View key={i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => setOpen(open === i ? null : i)}>
                {r.mode ? <ModeIcon mode={r.mode} /> : null}
                <Text style={[s.tx, { flex: 1 }]} numberOfLines={1}>{r.from.name} → {r.to.name}</Text>
                <Text style={s.dim}>{r.count} kez</Text>
                <Feather name={open === i ? 'chevron-up' : 'chevron-down'} size={16} color={C.faint} />
              </TouchableOpacity>
              <View style={s.rtGrid}>
                <Rt label="Çıkış" range={fmtMin(r.dep.min) + ' – ' + fmtMin(r.dep.max)} avg={fmtMin(r.dep.avg)} />
                <Rt label="Varış" range={fmtMin(r.arr.min) + ' – ' + fmtMin(r.arr.max)} avg={fmtMin(r.arr.avg)} />
                <Rt label="Yol" range={fmtDur(r.dur.min) + ' – ' + fmtDur(r.dur.max)} avg={fmtDur(r.dur.avg)} />
              </View>
              {open === i ? r.list.map((j, k) => (
                <View key={k} style={s.row}>
                  <Text style={[s.dim, { width: 84 }]}>{fmtDay(j.dep)}</Text>
                  <Text style={[s.num, { flex: 1 }]}>{fmtClock(j.dep)} → {fmtClock(j.arr)}</Text>
                  {j.stops ? <Text style={s.dim}>{j.stops} ara durak</Text> : null}
                  <Text style={[s.num, { width: 70, textAlign: 'right' }]}>{fmtDur(j.dur)}</Text>
                </View>
              )) : null}
            </View>
          )) : <Text style={s.dim}>Aynı güzergâh en az 2 kez tekrarlanınca burada görünür (ör. Ev → İş çıkış ve varış saat aralığı).</Text>}
        </Card>
      </ScrollView>
    </View>
  );
}
function Rt({ label, range, avg }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.statL}>{label}</Text>
      <Text style={s.num}>{range}</Text>
      <Text style={s.dim}>ort {avg}</Text>
    </View>
  );
}

// ===================== AYARLAR =====================
const PROFS = [['maks', 'Maksimum'], ['birebir', 'Birebir'], ['hassas', 'Dengeli'], ['pil', 'Pil dostu']];
const PROF_M = { maks: [1, 4], birebir: [2, 8], hassas: [12, 12], pil: [30, 30] }; // [hareket halinde, yavaşken] m (tracker.js ile aynı)
const PROF_TXT = {
  maks: 'Navigasyon doğruluğu: GPS hareket algılayıcısıyla birlikte çalışır. En ayrıntılı çizgi; pil en çok bu modda gider — uzun günlerde şarj önerilir.',
  birebir: 'GPS’in en yüksek doğruluğu. Önerilen: ayrıntı ile pil arasında denge.',
  hassas: 'Tür ayrımı için yeterli; virajlar hafif köşeli çizilir, pil daha az gider.',
  pil: 'Kaba konum (GPS yerine Wi-Fi/baz). Pil en az bu modda gider; çizgi yaklaşık olur.',
};
const STILLS = [[0, 'Hiç'], [60, '1 dk'], [120, '2 dk'], [300, '5 dk']];
function AyarlarTab({ trk, onToggle, profile, setProfile, onWipe, rev, onSnapReset }) {
  const st = useMemo(() => store.pointStats(), [rev, trk]);
  const [snapOn, setSnapOn] = useState(() => snap.enabled());
  const sst = useMemo(() => store.snapStats(), [rev]);
  // Tanı: ham durum (izin, görev, hata, sayaçlar). Sekme açılınca ve her yenilemede okunur.
  const [dg, setDg] = useState({});
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [still, setStillS] = useState(() => tracker.stillSec());
  useEffect(() => { let on = true; tracker.diag(false).then((d) => on && setDg((o) => ({ ...d, test: o.test }))); return () => { on = false; }; }, [rev, trk]);
  const runTest = async () => { setTesting(true); const d = await tracker.diag(true); setDg(d); setTesting(false); store.addLog('konum-testi', d.test || ''); };
  const doExport = async (days) => {
    setBusy(true);
    store.addLog('dışa-aktar', days ? 'son ' + days + ' gün' : 'tümü');
    try {
      const to = Date.now(), n = await extras.exportData(days ? addDays(dayStart(to), -(days - 1)) : 0, to + 1);
      if (!n) Alert.alert('Dışa aktarılacak veri yok');
    } catch (e) { Alert.alert('Dışa aktarılamadı', String((e && e.message) || e)); }
    setBusy(false);
  };
  const ago = (t) => (t ? fmtClockS(t) + ' (' + fmtDur(Date.now() - t) + ' önce)' : 'hiç');
  const yn = (v) => (v === true ? 'evet' : v === false ? 'HAYIR' : String(v));
  const perm = trk.bg ? ['Her zaman', C.ok] : trk.fg ? ['Yalnız kullanırken', C.warn] : ['İzin yok', C.bad];
  const stats = dg.stats || {};
  // Telefon kilitli / uygulama arkadayken kaydedilen nokta sayısı (görev + izleyici)
  const bgN = Object.keys(stats).filter((k) => /^(task|watchrec)-background$/.test(k)).reduce((n, k) => n + stats[k].n, 0);
  return (
    <ScrollView style={{ flex: 1, paddingTop: TOP }} contentContainerStyle={{ padding: 14, paddingBottom: 60 }}>
      <Text style={s.h1}>Ayarlar</Text>
      <Card title="KAYIT">
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: trk.running ? C.ok : C.bad }]} />
          <Text style={[s.tx, { flex: 1 }]}>{trk.running ? 'Konum kaydediliyor' : 'Kayıt durduruldu'}</Text>
          <TouchableOpacity style={[s.btn, !trk.running && { backgroundColor: C.accent, borderColor: C.accent }]} onPress={onToggle}>
            <Text style={[s.btnTx, !trk.running && { color: C.onAccent }]}>{trk.running ? 'Durdur' : 'Başlat'}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.row}>
          <Feather name="shield" size={15} color={perm[1]} />
          <Text style={[s.tx, { flex: 1 }]}>Konum izni: <Text style={{ color: perm[1] }}>{perm[0]}</Text></Text>
          <TouchableOpacity style={s.btn} onPress={() => Linking.openSettings()}><Text style={s.btnTx}>iOS Ayarları</Text></TouchableOpacity>
        </View>
        <View style={s.row}>
          <Feather name="moon" size={15} color={bgN ? C.ok : C.dim} />
          <Text style={[s.tx, { flex: 1 }]}>Arka planda kaydedilen nokta: <Text style={{ color: bgN ? C.ok : C.warn, fontWeight: '700' }}>{fmtInt(bgN)}</Text></Text>
        </View>
        <Text style={s.dim}>Kayıt sürerken telefon kilitliyken de yol kaydedilir; iOS bunu durum çubuğunda mavi konum göstergesiyle belli eder. Uygulamayı yukarı kaydırıp kapatma: iOS o zaman kaydı durdurur.</Text>
      </Card>
      <Card title="GPS HASSASİYETİ">
        {/* Kayıt ne kadar ayrıntılı: GPS doğruluğu + hareket halinde / yavaşken kaç metrede bir nokta */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PROFS.map(([k, label]) => <Chip key={k} label={label} active={profile === k} onPress={() => setProfile(k)} />)}
        </View>
        <Text style={[s.dim, { marginTop: 8 }]}>{PROF_TXT[profile] || PROF_TXT.birebir}</Text>
        {/* Durunca GPS'i kıs: bu süre yerinden kıpırdamazsan kaba konuma in (pil), kıpırdayınca anında geri dön */}
        <View style={[s.row, { marginTop: 8 }]}>
          <Feather name="battery-charging" size={15} color={still ? C.ok : C.dim} />
          <Text style={[s.tx, { flex: 1 }]}>Durunca GPS’i kıs</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {STILLS.map(([sec, label]) => <Chip key={sec} label={label} active={still === sec} onPress={() => { tracker.setStill(sec); setStillS(sec); store.addLog('ayar', "durunca GPS'i kıs: " + (sec ? sec + ' sn' : 'hiç')); }} />)}
        </View>
        <Text style={[s.dim, { marginTop: 8 }]}>{still ? (STILLS.find((x) => x[0] === still) || [0, still + ' sn'])[1] + ' yerinden kıpırdamazsan GPS kısılır (kayıt sürer, Wi-Fi/baz ~100 m); yürümeye ya da araca binmeye başlayınca anında tam doğruluğa döner. Işıkta/durakta kısa beklemek GPS’i kısmaz.' : 'GPS hep tam açık: en eksiksiz kayıt (duraktan çıkışın ilk metreleri bile), en çok pil.'}</Text>
        <View style={s.infoBox}>
          <Text style={s.tx}>Şu anki düzen: hareket halinde ~{(PROF_M[profile] || PROF_M.birebir)[0]} m’de, yavaşken ~{(PROF_M[profile] || PROF_M.birebir)[1]} m’de bir nokta; {still && profile !== 'pil' ? (STILLS.find((x) => x[0] === still) || [0, still + ' sn'])[1] + ' durunca GPS kısılır' : 'GPS hiç kısılmaz'}.</Text>
          <Text style={[s.dim, { marginTop: 3 }]}>GPS şu an: {dg.power === 'low' ? 'kısık (duruyorsun)' : dg.power === 'nav' ? 'navigasyon (araçtasın)' : 'tam doğruluk'}. Araçta GPS kendiliğinden navigasyon doğruluğuna çıkar. En doğru çizgi için: Maksimum ya da Birebir + «Hiç» — telefonu cepte değil, üst tarafı açıkta taşımak da GPS’i iyileştirir.</Text>
        </View>
      </Card>
      <Card title="YOLA OTURTMA">
        {snap.available() ? (
          <>
            <View style={s.row}>
              <Feather name="navigation-2" size={15} color={snapOn ? C.ok : C.dim} />
              <Text style={[s.tx, { flex: 1 }]}>Çizgiyi yola oturt</Text>
              <Chip label={snapOn ? 'Açık' : 'Kapalı'} active={snapOn} onPress={() => { snap.setEnabled(!snapOn); setSnapOn(!snapOn); onSnapReset(); store.addLog('ayar', 'yola oturtma: ' + (!snapOn ? 'açık' : 'kapalı')); }} />
            </View>
            <Text style={s.dim}>Bitmiş yolculukların GPS noktaları kendi sunucuna ({snap.SNAP_HOST}) gider; sunucu onları Azerbaycan yol haritasına oturtup çizgiyi geri yollar, hiçbir şey saklamaz. Çizgi gerçek izinden en çok ~12 m sapar: yol yakınsa yola oturur, değilse iz olduğu gibi kalır. Metro ve tahmini parçalar gönderilmez.</Text>
            <Text style={[s.dim, { marginTop: 6 }]}>Otobüs durağı listesi: {snap.stopsInfo() ? snap.stopsInfo().n + ' durak (OSM, ' + snap.stopsInfo().v + ')' : 'henüz inmedi'} — aracın durduğu yerler durağa denk geliyorsa otobüs sayılır.</Text>
            <Text style={[s.dim, { marginTop: 6 }]}>Oturan parça: {sst.ok} · oturmayan: {sst.fail} · son soru: {snap.status.at ? fmtClock(snap.status.at) : '—'}{snap.status.err ? ' · hata: ' + snap.status.err : ''}</Text>
            <TouchableOpacity style={[s.btn, { marginTop: 8, alignSelf: 'flex-start' }]} onPress={() => { snap.reset(); onSnapReset(); store.addLog('düğme', 'yeniden oturt'); }}>
              <Text style={s.btnTx}>Yeniden oturt</Text>
            </TouchableOpacity>
          </>
        ) : <Text style={s.dim}>Bu sürümde sunucu anahtarı yok; çizgi telefonda düzeltilir.</Text>}
      </Card>
      <Card title="VERİ">
        <View style={s.row}><Text style={[s.tx, { flex: 1 }]}>Kayıtlı nokta</Text><Text style={s.num}>{fmtInt(st.n)}</Text></View>
        <View style={s.row}><Text style={[s.tx, { flex: 1 }]}>İlk kayıt</Text><Text style={s.num}>{st.first ? fmtDay(st.first) + ' ' + fmtClock(st.first) : '—'}</Text></View>
        <View style={s.row}><Text style={[s.tx, { flex: 1 }]}>Son kayıt</Text><Text style={s.num}>{st.last ? fmtDay(st.last) + ' ' + fmtClock(st.last) : '—'}</Text></View>
        <Text style={s.dim}>Kayıtlar yalnız bu telefonda saklanır. Yola oturtma açıkken bitmiş yolculukların noktaları eşleştirme için kendi sunucuna gider; orada saklanmaz.</Text>
        {/* Dışa aktarma: ham kayıtları dosya olarak paylaş (gerçek veriyle ayar yapmak / yedeklemek için) */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <TouchableOpacity style={s.btn} disabled={busy} onPress={() => doExport(3)}><Text style={s.btnTx}>{busy ? 'Hazırlanıyor…' : 'Dışa aktar · son 3 gün'}</Text></TouchableOpacity>
          <TouchableOpacity style={s.btn} disabled={busy} onPress={() => doExport(0)}><Text style={s.btnTx}>Tümü</Text></TouchableOpacity>
          <TouchableOpacity style={[s.btn, { borderColor: C.bad }]} onPress={onWipe}><Text style={[s.btnTx, { color: C.bad }]}>Tüm veriyi sil</Text></TouchableOpacity>
        </View>
      </Card>
      <Card title="OLAY GÜNLÜĞÜ (LOG)" right={<Text style={s.dim}>{fmtInt(store.logCount())} kayıt</Text>}>
        {/* Bastığın düğmeler, ayar değişiklikleri, tür düzeltmeleri, uygulama / kayıt / GPS olayları — saatle.
            Dışa aktarılan dosyaya da girer: sorun olunca sırayla "ne oldu" okunur. */}
        {store.getLogs(0, Date.now() + 1, 25).map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
            <Text style={[s.dim, { width: 58, ...mono }]}>{fmtClockS(r.t)}</Text>
            <Text style={[s.dim, { flex: 1 }]} numberOfLines={2}><Text style={{ color: C.text, fontWeight: '600' }}>{r.k}</Text>{r.v ? ' · ' + r.v : ''}</Text>
          </View>
        ))}
        <Text style={[s.dim, { marginTop: 6 }]}>Son 25 olay. Tamamı «Dışa aktar» dosyasına eklenir; 30 günden eskisi kendiliğinden silinir.</Text>
      </Card>
      <Card title="TANI">
        {[
          ['Konum servisleri açık', yn(dg.services)],
          ['İzin (kullanırken)', String(dg.fg)],
          ['İzin (her zaman)', String(dg.bg)],
          ['Hareket izni (adım / araç ayrımı)', String(dg.motion)],
          ['Arka plan görevi kayıtlı', yn(dg.registered)],
          ['Son başlatma', ago(dg.d_startAt)],
          ['Başlatma hatası', dg.d_startErr || 'yok'],
          ['Görev hatası', dg.d_taskErr || 'yok'],
          ['İzleyici hatası', dg.d_watchErr || 'yok'],
          ['Hareket kaydı hatası', dg.d_actErr || 'yok'],
          // Sayaçlar: kaynak-durum → adet (son saat). «background» satırları arka planda çalıştığını kanıtlar.
          ...Object.keys(stats).sort().map((k) => [k, stats[k].n + ' · ' + ago(stats[k].last)]),
          ['Konum testi', testing ? 'bekleniyor…' : dg.test || 'yapılmadı'],
        ].map(([k, v]) => (
          <View key={k} style={{ paddingVertical: 4 }}>
            <Text style={s.dim}>{k}</Text>
            <Text style={s.num} selectable>{v}</Text>
          </View>
        ))}
        <TouchableOpacity style={[s.btn, { marginTop: 8, alignSelf: 'flex-start' }]} disabled={testing} onPress={runTest}>
          <Text style={s.btnTx}>Konum testi yap</Text>
        </TouchableOpacity>
      </Card>
      <Text style={[s.tx, { textAlign: 'center', fontWeight: '700' }]}>İZ · sürüm {VERSION}</Text>
    </ScrollView>
  );
}

// ===================== Yolculuk ayrıntısı =====================
// Hız grafiği: yatay zaman, dikey hız; her parça kendi türünün renginde. Araçta duruşlar (ışık/durak)
// grafikte sıfıra inen çukurlar olarak görünür. Grafiğe dokunup kaydırınca o an haritada gösterilir (onPick).
function SpeedChart({ trip, width, pick, onPick }) {
  const H = 96, pts = trip.pts, n = pts.length;
  // kayıt boşluğu / GPS'siz parçanın uçlarında anlık hız bilinmez
  const vAt = (k) => (trip.dash[k] || (k > 0 && trip.dash[k - 1]) ? null : pts[k].v);
  const maxV = Math.max(2, ...pts.map((p, k) => vAt(k) || 0), ...trip.legs.map((l) => (l.est ? l.avg : 0)));
  const X = (t) => ((t - trip.t0) / Math.max(1, trip.dur)) * width, Y = (v) => H - 4 - (v / maxV) * (H - 12);
  const step = Math.max(1, Math.floor(n / 300)); // en çok ~300 nokta çiz
  const lines = trip.legs.map((l, li) => {
    const out = [];
    for (let k = l.a; ; k = Math.min(l.b, k + step)) {
      const v = vAt(k);
      out.push(X(pts[k].t).toFixed(1) + ',' + Y(v == null ? l.avg : v).toFixed(1)); // bilinmiyorsa parça ortalaması
      if (k === l.b) break;
    }
    return <Polyline key={li} points={out.join(' ')} fill="none" stroke={MODE[trip.overridden ? trip.mode : l.mode].color} strokeWidth={2} strokeLinejoin="round" />;
  });
  const handle = (e) => onPick && onPick(trip.t0 + Math.max(0, Math.min(1, e.nativeEvent.locationX / width)) * trip.dur);
  return (
    <View>
      {/* dokunma bu kutuda yakalanır; çizim dokunmayı almaz (locationX kutuya göre gelsin) */}
      <View onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}
        onResponderGrant={handle} onResponderMove={handle}>
        <View pointerEvents="none">
          <Svg width={width} height={H}>
            <Line x1={0} y1={H - 4} x2={width} y2={H - 4} stroke={C.line} strokeWidth={1} />
            <Line x1={0} y1={Y(maxV)} x2={width} y2={Y(maxV)} stroke={C.line} strokeWidth={1} strokeDasharray="3 4" />
            {lines}
            {pick ? <Line x1={X(pick)} y1={0} x2={X(pick)} y2={H} stroke={C.text} strokeWidth={1.2} /> : null}
          </Svg>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={s.axis}>{fmtClock(trip.t0)}</Text>
        <Text style={s.axis}>üst çizgi: {fmtKmh(maxV)}</Text>
        <Text style={s.axis}>{fmtClock(trip.t1)}</Text>
      </View>
    </View>
  );
}

function TripModal({ trip, onClose, onMode }) {
  const [w, setW] = useState(0);
  const [pick, setPick] = useState(null); // hız grafiğinde seçilen an (ms)
  const [ly, toggleLy] = useLayers('layers_trip', { track: false, dots: true, rings: false });
  // Ayrıntı haritası: çizgi + katmanlar (turuncu iz, GPS noktaları, doğruluk halkası) + olay noktaları
  const base = useMemo(() => (trip ? { legs: tripLines(trip), marks: tripMarks(trip) } : null), [trip]);
  const legs = useMemo(() => (!trip ? [] : ly.track ? [tripTrack(trip), ...base.legs] : base.legs), [trip, base, ly.track]);
  const dots = useMemo(() => (trip && ly.dots ? tripDots(trip) : null), [trip, ly.dots]);
  const rings = useMemo(() => (trip && ly.rings ? tripRings(trip) : null), [trip, ly.rings]);
  // Seçilen anın konumu (yola oturtulmuşsa birleşik çizgideki yeri) + etiketi: saat · hız · tür
  const cursor = useMemo(() => {
    if (!trip || pick == null) return null;
    let k = 0;
    for (let i = 1; i < trip.pts.length; i++) if (Math.abs(trip.pts[i].t - pick) < Math.abs(trip.pts[k].t - pick)) k = i;
    const leg = trip.legs.find((l) => k >= l.a && k <= l.b) || trip.legs[0], q = leg.snap ? leg.snap.pts[k - leg.a] : trip.pts[k];
    return { lat: q.lat, lon: q.lon, label: fmtClockS(trip.pts[k].t) + ' · ' + fmtKmh(trip.pts[k].v || 0) + ' · ' + MODE[trip.overridden ? trip.mode : leg.mode].label };
  }, [trip, pick]);
  const [steps, setSteps] = useState({}); // parça indeksi -> adım (yalnız yaya parçaları)
  // Yaya parçalarının adımını telefonun adımsayarından sor (son 7 gün için var).
  useEffect(() => {
    setPick(null);
    if (!trip) return;
    let on = true; setSteps({});
    trip.legs.forEach((l, i) => {
      if (l.mode !== 'walk' || l.est) return;
      extras.stepsBetween(l.t0, l.t1).then((n) => { if (on && n != null) setSteps((o) => ({ ...o, [i]: n })); });
    });
    return () => { on = false; };
  }, [trip]);
  if (!trip) return null;
  const title = stName(trip.fromStay) && stName(trip.toStay) ? stName(trip.fromStay) + ' → ' + stName(trip.toStay) : MODE[trip.mode].label + ' · ' + fmtKm(trip.dist);
  const share = () => { store.addLog('gpx-paylaş', title + ' · ' + fmtDay(trip.t0)); extras.exportGpx(trip, title + ' · ' + fmtDay(trip.t0)).catch((e) => Alert.alert('Paylaşılamadı', String((e && e.message) || e))); };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: TOP }}>
        <View style={s.modalHead}>
          <TouchableOpacity style={s.iconBtn} onPress={onClose}><Feather name="chevron-down" size={22} color={C.text} /></TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.h2} numberOfLines={1}>{title}</Text>
            <Text style={s.dim}>{fmtDay(trip.t0)} · {fmtClock(trip.t0)} – {fmtClock(trip.t1)}</Text>
          </View>
          {/* GPX: iz dosyası olarak paylaş (her harita/spor uygulaması açar) */}
          <TouchableOpacity style={s.iconBtn} onPress={share}><Feather name="share" size={19} color={C.accent} /></TouchableOpacity>
        </View>
        <View style={{ height: 250 }}>
          <MapPane legs={legs} stays={[]} marks={base.marks} dots={dots} rings={rings} cursor={cursor} fitKey={'trip' + trip.t0} pad={{ top: 40, right: 40, bottom: 40, left: 40 }} />
        </View>
        <View style={s.layerBar}>
          {LAYERS.map(([k, label]) => <Chip key={k} label={label} active={!!ly[k]} onPress={() => toggleLy(k)} />)}
        </View>
        <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 4, paddingBottom: 40 }}>
          <Card>
            <View style={s.statRow}>
              <Stat label="Mesafe" value={fmtKm(trip.dist)} />
              <Stat label="Süre" value={fmtDur(trip.dur)} />
              <Stat label="Ort. hız" value={fmtKmh(trip.avg)} />
              <Stat label="Tepe hız" value={fmtKmh(trip.max)} />
            </View>
            <LegBar trip={trip} />
          </Card>
          <Card title="OLAYLAR — SİSTEM NE ANLADI">
            {tripEvents(trip).map((e, i) => (
              <View key={i} style={s.row}>
                <Text style={[s.num, { width: 44 }]}>{fmtClock(e.t)}</Text>
                {e.wait ? <MaterialCommunityIcons name="pause-circle-outline" size={16} color={C.dim} /> : e.end ? <Feather name="flag" size={15} color={C.accent} /> : <ModeIcon mode={e.mode} />}
                <Text style={[s.tx, { flex: 1 }]}>{e.text}</Text>
              </View>
            ))}
          </Card>
          <Card title="HIZ" right={<Text style={[s.dim, { fontSize: 11 }]}>{cursor ? cursor.label : 'dokun: haritada o an'}</Text>}>
            <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>{w > 0 ? <SpeedChart trip={trip} width={w} pick={pick} onPick={setPick} /> : null}</View>
          </Card>
          <Card title="PARÇALAR">
            {trip.legs.map((l, i) => (
              <View key={i} style={{ paddingVertical: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ModeIcon mode={l.mode} />
                  <Text style={[s.tx, { flex: 1 }]}>{MODE[l.mode].label}{l.est ? ' (tahmini)' : ''}</Text>
                  <Text style={s.num}>{fmtKm(l.dist)}</Text>
                  <Text style={[s.num, { width: 74, textAlign: 'right' }]}>{fmtDur(l.dur)}</Text>
                </View>
                <Text style={[s.dim, { marginLeft: 24 }]}>
                  {fmtClock(l.t0)} – {fmtClock(l.t1)} · ort {fmtKmh(l.avg)}
                  {(l.mode === 'car' || l.mode === 'bus') && l.stops ? ' · ' + l.stops + ' duruş (' + fmtDur(l.stopMs) + ')' : ''}
                  {(l.mode === 'car' || l.mode === 'bus') && l.slowMs >= 60e3 ? ' · trafikte yavaş ' + fmtDur(l.slowMs) : ''}
                  {(l.mode === 'car' || l.mode === 'bus') && l.atStops != null && l.stopPts.length ? ' · durakta duruş ' + l.atStops + '/' + l.stopPts.length : ''}
                  {steps[i] != null ? ' · ' + fmtInt(steps[i]) + ' adım' : ''}{waitTxt(l)}
                </Text>
                {l.gps ? <Text style={[s.dim, { marginLeft: 24, color: l.gps.lvl === 'zayıf' ? C.warn : C.dim }]}>GPS {l.gps.lvl} · ±{l.gps.acc} m · {Math.round(l.gps.gap)} sn’de bir nokta{l.gps.lvl === 'zayıf' ? ' — bu parçanın çizgisi yaklaşık' : ''}{l.snap ? ' · yola oturtuldu' : ''}</Text> : null}
              </View>
            ))}
            <Text style={[s.dim, { marginTop: 4 }]}>Tür; telefonun hareket algılayıcısından (yürüyor / araçta) ve hızdan çıkarılır. Otobüs: durak durak gidiş + öncesinde ya da sonrasında yürüyüş. Araçtan inip en az 1 dk yürüme hızında gidersen ayrı yaya parçası olur. Kesikli çizgi: GPS’siz ya da kayıt boşluğu (tahmini); soluk çizgi: GPS zayıf. Beyaz oklar gidiş yönünü gösterir.{trip.legs.some((l) => l.snap) ? ' Yola oturtulmuş parçalar yolu izler (gerçek izden en çok ~12 m); mesafe o çizgiden ölçülür — turuncu iz katmanıyla karşılaştırabilirsin.' : ''}</Text>
          </Card>
          <Card title="TÜR YANLIŞSA DÜZELT">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Otomatik" active={!trip.override} onPress={() => onMode(trip, null)} />
              {MODES.map((m) => <Chip key={m} label={MODE[m].label} color={MODE[m].color} active={trip.override === m} onPress={() => onMode(trip, m)} />)}
            </View>
          </Card>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ===================== Yer ayrıntısı (ad + tür) =====================
function PlaceModal({ place, onClose, onSave }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState(null);
  useEffect(() => { if (place) { setName(place.saved && place.saved.name ? place.saved.name : ''); setKind(place.kind || null); } }, [place]);
  if (!place) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.sheetBg}>
        <View style={s.sheet}>
          <Text style={s.h2}>{place.name}</Text>
          <Text style={s.dim}>{place.addr ? place.addr + ' · ' : ''}{fmtDur(place.total)} · {place.visits} ziyaret</Text>
          <Text style={[s.statL, { marginTop: 14 }]}>AD</Text>
          <TextInput value={name} onChangeText={setName} placeholder="ör. Spor salonu" placeholderTextColor={C.faint} style={s.input} />
          <Text style={[s.statL, { marginTop: 12, marginBottom: 6 }]}>TÜR</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="Ev" active={kind === 'home'} onPress={() => setKind('home')} />
            <Chip label="İş" active={kind === 'work'} onPress={() => setKind('work')} />
            <Chip label="Diğer" active={kind === 'other' || !kind} onPress={() => setKind('other')} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
            <TouchableOpacity style={s.btn} onPress={onClose}><Text style={s.btnTx}>Vazgeç</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: C.accent, borderColor: C.accent }]} onPress={() => onSave(place, name.trim(), kind || 'other')}>
              <Text style={[s.btnTx, { color: C.onAccent }]}>Kaydet</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ===================== KÖK =====================
const TABS = [['harita', 'map', 'Harita'], ['gunluk', 'list', 'Günlük'], ['analiz', 'bar-chart-2', 'Analiz'], ['ayarlar', 'settings', 'Ayarlar']];

export default function App() {
  const [tab, setTab] = useState('harita');
  const [day, setDay] = useState(dayStart(Date.now()));
  const [rev, setRev] = useState(0); // düzenleme sayacı (ad/tür düzeltmesi, silme) — uzun dönem analizini yeniler
  const [tick, setTick] = useState(0); // saat: günlük görünümü 4 sn'de bir yeniler (yeni noktalar)
  const [trk, setTrk] = useState({ fg: false, bg: false, running: false });
  const [profile, setProfileS] = useState(() => store.getKV('profile', 'birebir'));
  const [hints, setHints] = useState(() => store.getKV('hints', null));
  const [trip, setTrip] = useState(null);
  const [place, setPlace] = useState(null);
  const [me, setMe] = useState(null); // canlı konum {lat, lon, acc, spd}
  const [steps, setSteps] = useState(null); // seçili günün adım sayısı
  const [active, setActive] = useState(AppState.currentState !== 'background'); // uygulama ekranda mı
  const tried = useRef(new Set()); // adres sorgusu denenmiş yerler (aynı yeri tekrar tekrar sorma)
  const bump = useCallback(() => setRev((r) => r + 1), []);

  // Açılış: durum oku; kullanıcı kaydı açık bırakmışsa (yeniden kurulum / yeniden başlatma) sürdür.
  // Ayrıca son 14 günden ev/iş konumunu çıkar — tek günlük görünümler bu ipucunu kullanır.
  useEffect(() => {
    (async () => {
      let st = await tracker.status();
      // Kayıt açık bırakılmışsa HER açılışta yeniden başlat (izin düşmüşse start() izin penceresini açar).
      store.addLog('açılış', 'sürüm ' + VERSION + ' · profil ' + profile + ' · kayıt ' + (store.getKV('rec', false) ? 'açık' : 'kapalı') + ' · izin ' + (st.bg ? 'her zaman' : st.fg ? 'kullanırken' : 'yok'));
      if (store.getKV('rec', false)) { st = await tracker.start(profile); store.setKV('applied', profile); }
      setTrk(st);
    })();
    // Otobüs durak listesi (yoksa / eskiyse) sunucudan bir kez indirilir; gelince analiz yenilenir
    snap.fetchStops().then((got) => got && bump());
    const to = addDays(dayStart(Date.now()), 1);
    const r = loadRange(addDays(to, -14), to, false, null, true);
    const pick = (k) => { const p = r.places.find((x) => x.kind === k && x.auto); return p ? { lat: p.lat, lon: p.lon } : null; };
    const h = { home: pick('home'), work: pick('work') };
    if (h.home || h.work) { store.setKV('hints', h); setHints(h); }
  }, []);

  // Canlı konum izleyicisi (mavi nokta + anlık hız): yalnız harita ekrandayken çalışır. Uygulama arka
  // plana geçince durur; arka planda kaydı görev (tracker.js) sürdürür. Kayıt açıksa izleyicinin aldığı
  // noktalar da saklanır.
  useEffect(() => {
    if (!trk.fg || tracker.testMode() || !(tab === 'harita' && active)) return;
    return tracker.watch(setMe, trk.running, profile);
  }, [trk.fg, trk.running, tab, active, profile]);

  // Hareket kaydı (yürüyor / araçta): kayıt açıkken dinle.
  useEffect(() => {
    if (!trk.running) return;
    tracker.startActivity();
    return () => tracker.stopActivity();
  }, [trk.running]);

  // Uygulama öne gelince durumu tazele; yalnız ekrandayken 4 sn'de bir yenile (arka planda boşuna çalışma).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (a) => {
      setActive(a !== 'background');
      store.addLog('uygulama', a === 'active' ? 'öne geldi' : a === 'background' ? 'arka plana gitti' : a);
      if (a === 'active') { bump(); tracker.status().then(setTrk); }
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((x) => x + 1), 4e3);
    return () => clearInterval(id);
  }, [active]);

  // Günün analizi pahalıdır (binlerce nokta düzeltilir). Her 4 sn'de yeniden yapmak yerine yalnız veri
  // değiştiğinde (yeni nokta geldi) ya da dakikada bir (süren durağın süresi güncellensin) yapılır.
  const ver = useMemo(() => store.rangeVersion(addDays(day, -1), addDays(day, 2)) + ':' + Math.floor(Date.now() / 60e3), [day, tick, rev]);
  const data = useMemo(() => loadRange(day, addDays(day, 1), trk.running, hints, false), [day, rev, ver, trk.running, hints]);

  // Yola oturtma: günün bitmiş parçalarını sunucuya sor (önbellekte olmayanlar); sonuç gelince analiz yenilenir.
  useEffect(() => { if (active) snap.fill(data.items).then((got) => got && bump()); }, [data, active]);

  // Son hareket kaydı (yürüyor/araçta…) — haritadaki canlı durum için; 3 dk'dan eskisi geçersiz.
  const lastAct = useMemo(() => {
    if (!trk.running) return null;
    const a = store.getActivity(Date.now() - 3 * 60e3, Date.now() + 1), x = a[a.length - 1];
    return x && x.c >= 1 ? x.k : null;
  }, [tick, trk.running]);

  // Seçili günün adım sayısı (telefonun adımsayarı; son 7 gün). Dakikada bir tazelenir.
  const stepSlot = Math.floor(tick / 15);
  useEffect(() => {
    let on = true;
    extras.stepsBetween(day, Math.min(Date.now(), addDays(day, 1))).then((n) => { if (on) setSteps(n); });
    return () => { on = false; };
  }, [day, stepSlot, trk.running]);

  // Yeni görülen yerlerin adresini bir kez sor ve kaydet (sonraki analizlerde adıyla gelir).
  useEffect(() => {
    const todo = data.places.filter((p) => !p.saved && p.total >= 10 * 60e3 && !tried.current.has(p.lat.toFixed(3) + p.lon.toFixed(3))).slice(0, 3);
    if (!todo.length) return;
    todo.forEach((p) => tried.current.add(p.lat.toFixed(3) + p.lon.toFixed(3)));
    (async () => {
      let any = false;
      for (const p of todo) {
        const addr = await tracker.geocode(p.lat, p.lon);
        if (addr) { store.addPlace({ lat: p.lat, lon: p.lon, addr }); any = true; }
      }
      if (any) bump();
    })();
  }, [data]);

  const onToggle = async () => {
    store.addLog('düğme', trk.running ? 'kaydı durdur' : 'kaydı başlat');
    if (trk.running) { store.setKV('rec', false); setTrk(await tracker.stop()); return; }
    const st = await tracker.start(profile);
    setTrk(st);
    if (st.running) { store.setKV('rec', true); store.setKV('applied', profile); }
    else Alert.alert('Konum izni gerekli', 'Kayıt için iOS Ayarları → Konum bölümünden izin ver.', [{ text: 'Vazgeç' }, { text: 'Ayarları aç', onPress: () => Linking.openSettings() }]);
  };
  const setProfile = async (p) => {
    store.addLog('ayar', 'GPS profili: ' + profile + ' → ' + p);
    setProfileS(p); store.setKV('profile', p);
    if (trk.running) { setTrk(await tracker.start(p)); store.setKV('applied', p); } // yeni hassasiyetle yeniden başlat
  };
  const onMode = (t, mode) => {
    store.addLog('tür-düzeltme', fmtDay(t.t0) + ' ' + fmtClock(t.t0) + ' yolculuğu · otomatik ' + MODE[t.autoMode || t.mode].label + ' → ' + (mode ? MODE[mode].label : 'otomatik'));
    store.setOverride(t.t0, mode); setTrip(null); bump();
  };
  const onSavePlace = (p, name, kind) => {
    const id = p.saved ? p.saved.id : store.addPlace({ lat: p.lat, lon: p.lon, addr: p.addr });
    store.updatePlace(id, name, kind);
    store.addLog('yer-kaydet', (p.name || '') + ' → ' + (name || '(adsız)') + ' · ' + kind);
    setPlace(null); bump();
  };
  const onWipe = () => Alert.alert('Tüm veriyi sil', 'Kaydedilmiş bütün konumlar, yerler ve düzeltmeler silinir. Geri alınamaz.', [
    { text: 'Vazgeç' },
    { text: 'Sil', style: 'destructive', onPress: () => { store.wipeAll(); store.addLog('veri-silindi', 'tüm veri silindi'); store.setKV('rec', trk.running); store.setKV('profile', profile); setHints(null); tried.current.clear(); bump(); } },
  ]);

  // Gezinme de günlüğe: hangi sekme, hangi gün, hangi yolculuk / yer açıldı
  const goTab = (k) => { setTab(k); store.addLog('sekme', k); };
  const goDay = (d) => { setDay(d); store.addLog('gün', fmtDay(d)); };
  const openTrip = (t) => { setTrip(t); if (t) store.addLog('yolculuk-aç', fmtDay(t.t0) + ' ' + fmtClock(t.t0) + ' · ' + MODE[t.mode].label + ' · ' + fmtKm(t.dist)); };
  const openPlace = (p) => { setPlace(p); if (p) store.addLog('yer-aç', p.name); };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {tab === 'harita' ? <HaritaTab data={data} day={day} setDay={goDay} trk={trk} onToggle={onToggle} onPlace={openPlace} onTrip={openTrip} me={me} steps={steps} lastAct={lastAct} /> : null}
        {tab === 'gunluk' ? <GunlukTab data={data} day={day} setDay={goDay} onTrip={openTrip} onPlace={openPlace} steps={steps} /> : null}
        {tab === 'analiz' ? <AnalizTab trk={trk} hints={hints} rev={rev} onPlace={openPlace} onTrip={openTrip} onSnap={bump} /> : null}
        {tab === 'ayarlar' ? <AyarlarTab trk={trk} onToggle={onToggle} profile={profile} setProfile={setProfile} onWipe={onWipe} rev={rev + tick} onSnapReset={bump} /> : null}
      </View>
      <View style={[s.nav, { paddingBottom: BOTTOM }]}>
        {TABS.map(([k, icon, label]) => (
          <TouchableOpacity key={k} style={s.navBtn} onPress={() => goTab(k)}>
            <Feather name={icon} size={20} color={tab === k ? C.accent : C.dim} />
            <Text style={[s.navTx, tab === k && { color: C.accent }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TripModal trip={trip} onClose={() => setTrip(null)} onMode={onMode} />
      <PlaceModal place={place} onClose={() => setPlace(null)} onSave={onSavePlace} />
    </View>
  );
}

const mono = { fontVariant: ['tabular-nums'] };
const s = StyleSheet.create({
  tx: { color: C.text, fontSize: 14 },
  dim: { color: C.dim, fontSize: 12 },
  num: { color: C.text, fontSize: 13, fontWeight: '600', ...mono },
  h1: { color: C.text, fontSize: 22, fontWeight: '700', marginBottom: 12 },
  h2: { color: C.text, fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginBottom: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 1, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel },
  chipTx: { color: C.dim, fontSize: 13, fontWeight: '600' },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.line },
  btnTx: { color: C.text, fontSize: 13, fontWeight: '600' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dateBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 10, height: 46 },
  dateTx: { color: C.text, fontSize: 15, fontWeight: '600' },
  dateSub: { color: C.dim, fontSize: 10 },
  overlayTop: { position: 'absolute', left: 14, right: 14 },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line },
  anMap: { height: 250, marginHorizontal: 14, marginTop: 10, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  permBanner: { position: 'absolute', left: 14, right: 14, top: TOP + 150, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.bad, borderRadius: 10, padding: 12 },
  permTx: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  locBtn: { width: 40, height: 40, borderRadius: 10, marginTop: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  recTx: { color: C.text, fontSize: 12, fontWeight: '600' },
  overlayBottom: { position: 'absolute', left: 14, right: 14, bottom: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, gap: 10 },
  statRow: { flexDirection: 'row', gap: 10 },
  statV: { color: C.text, fontSize: 15, fontWeight: '700', ...mono },
  statL: { color: C.dim, fontSize: 11, marginTop: 1 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, backgroundColor: C.panel2 },
  modeChipTx: { color: C.text, fontSize: 13, fontWeight: '600', ...mono },
  tl: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  group: { borderLeftWidth: 2, borderLeftColor: C.line, paddingLeft: 8, marginVertical: 4 },
  groupTx: { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginTop: 4 },
  tlIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: C.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel2 },
  axis: { color: C.faint, fontSize: 10, textAlign: 'center' },
  barBg: { height: 4, borderRadius: 2, backgroundColor: C.panel2, marginVertical: 5 },
  barFg: { height: 4, borderRadius: 2, backgroundColor: C.accent },
  rtGrid: { flexDirection: 'row', marginTop: 8, gap: 8 },
  nav: { flexDirection: 'row', backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 },
  navBtn: { flex: 1, alignItems: 'center', gap: 3 },
  navTx: { color: C.dim, fontSize: 10, fontWeight: '600' },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 8 },
  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16 },
  // Günlük: 24 saat şeridi + akış rayı
  strip: { height: 14, borderRadius: 7, backgroundColor: C.panel2, overflow: 'hidden' },
  stripSeg: { position: 'absolute', top: 0, bottom: 0 },
  stripNow: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.text },
  legBar: { flexDirection: 'row', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 6, gap: 2 },
  legChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 2, marginTop: 3 },
  legChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legChipTx: { color: C.text, fontSize: 12, fontWeight: '600', ...mono },
  tlRow: { flexDirection: 'row', alignItems: 'stretch' },
  tlTime: { width: 42, color: C.dim, fontSize: 12, fontWeight: '600', paddingTop: 9, ...mono },
  tlRail: { width: 32, alignItems: 'center' },
  tlDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel, marginTop: 3 },
  tlLine: { flex: 1, width: 2, backgroundColor: C.line, marginTop: 2 },
  tlBody: { flex: 1, paddingLeft: 8, paddingTop: 5, paddingBottom: 14 },
  tlTitle: { color: C.text, fontSize: 14, fontWeight: '600' },
  tlRight: { paddingTop: 8, paddingLeft: 6 },
  // Harita katmanları
  layerPanel: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 8, gap: 6, alignSelf: 'flex-end' },
  layerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  layerSw: { width: 14, height: 4, borderRadius: 2 },
  layerBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  infoBox: { marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: C.panel2 },
  input: { marginTop: 6, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: C.text, fontSize: 14, backgroundColor: C.bg },
});
