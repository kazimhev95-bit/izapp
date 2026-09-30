// İZ — kişisel konum günlüğü. Telefon gittiğin yolu kaydeder; motor (src/engine.js) bunu
// duraklara, yolculuklara, ulaşım türlerine ve rutinlere çevirir. Veri yalnız cihazda durur.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Rect } from 'react-native-svg';
import MapPane from './src/MapPane';
import * as store from './src/store';
import * as tracker from './src/tracker';
import { analyze, dayStart, addDays, MODES } from './src/engine';
import { C, MODE, fmtClock, fmtMin, fmtDay, fmtDayShort, fmtDate, fmtDur, fmtKm, fmtKmh } from './src/theme';

const VERSION = require('./app.json').expo.version;
const TOP = Platform.OS === 'ios' ? 54 : 14;   // çentik payı
const BOTTOM = Platform.OS === 'ios' ? 26 : 8; // ana ekran çizgisi payı
const KIND_ICON = { home: 'home', work: 'briefcase' };
const toCoords = (pts) => pts.map((p) => ({ latitude: p.lat, longitude: p.lon }));

// Bir yolculuğun haritada çizilecek renkli parçaları (elle düzeltildiyse tek renk).
function tripLegs(trip) {
  if (trip.overridden) return [{ mode: trip.mode, coords: toCoords(trip.pts) }];
  return trip.legs.map((l) => ({ mode: l.mode, coords: toCoords(trip.pts.slice(l.a, l.b + 1)) }));
}

// [from,to) aralığını depodan okuyup analiz eder. Gece yarısını aşan duraklar için ±1 gün pay okunur.
function loadRange(from, to, running, hints, detect) {
  const now = Date.now();
  return analyze(store.getPoints(addDays(from, -1), addDays(to, 1)), {
    from, to, saved: store.getPlaces(), overrides: store.getOverrides(), hints, detect,
    now: running && addDays(to, 1) > now ? now : undefined, // "hâlâ orada" yalnız güncel aralıkta
  });
}

// ===================== Küçük ortak parçalar =====================
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

// ===================== HARİTA =====================
function HaritaTab({ data, day, setDay, trk, onToggle, onPlace }) {
  const legs = useMemo(() => data.items.filter((i) => i.type === 'trip').flatMap(tripLegs), [data]);
  const stays = useMemo(() => data.places.map((p) => ({ key: p.id, lat: p.lat, lon: p.lon, kind: p.kind, place: p })), [data]);
  const t = data.totals;
  return (
    <View style={{ flex: 1 }}>
      <MapPane legs={legs} stays={stays} fitKey={String(day)} live={day >= dayStart(Date.now())} onStayPress={(m) => onPlace(m.place)} />
      <View style={[s.overlayTop, { top: TOP }]}>
        <DateBar day={day} setDay={setDay} />
        <TouchableOpacity style={s.recPill} onPress={onToggle}>
          <View style={[s.dot, { backgroundColor: trk.running ? C.ok : C.bad }]} />
          <Text style={s.recTx}>{trk.running ? 'Kayıt açık' : 'Kayıt kapalı — başlat'}</Text>
        </TouchableOpacity>
      </View>
      <View style={s.overlayBottom}>
        <View style={s.statRow}>
          <Stat label="Mesafe" value={fmtKm(t.dist)} />
          <Stat label="Yolda" value={fmtDur(t.moveMs)} />
          <Stat label="Durakta" value={fmtDur(t.stayMs)} />
          <Stat label="Yer" value={String(data.places.length)} />
        </View>
        <ModeRow modes={t.modes} />
      </View>
    </View>
  );
}
function Stat({ label, value }) {
  return <View style={{ flex: 1 }}><Text style={s.statV} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={s.statL}>{label}</Text></View>;
}

// ===================== GÜNLÜK (zaman çizelgesi) =====================
function GunlukTab({ data, day, setDay, onTrip, onPlace }) {
  const now = Date.now();
  const dayPlaces = data.places.filter((p) => p.total > 0);
  return (
    <View style={{ flex: 1, paddingTop: TOP }}>
      <View style={{ paddingHorizontal: 14 }}><DateBar day={day} setDay={setDay} /></View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
        <Card title="NEREDE NE KADAR">
          {dayPlaces.length ? dayPlaces.map((p) => (
            <TouchableOpacity key={p.id} style={s.row} onPress={() => onPlace(p)}>
              <Feather name={KIND_ICON[p.kind] || 'map-pin'} size={15} color={C.accent} />
              <Text style={[s.tx, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
              <Text style={s.dim}>{p.visits > 1 ? p.visits + ' kez · ' : ''}</Text>
              <Text style={s.num}>{fmtDur(p.total)}</Text>
            </TouchableOpacity>
          )) : <Text style={s.dim}>Bu gün için kayıt yok</Text>}
        </Card>
        <Card title="GÜN AKIŞI">
          {data.items.length ? data.items.map((it, i) => {
            if (it.type === 'stay') return (
              <TouchableOpacity key={i} style={s.tl} onPress={() => onPlace(it.place)}>
                <View style={s.tlIcon}><Feather name={KIND_ICON[it.place.kind] || 'map-pin'} size={14} color={C.text} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.tx} numberOfLines={1}>{it.place.name}</Text>
                  <Text style={s.dim}>{fmtClock(it.t0)} – {now - it.t1 < 60e3 ? 'şimdi' : fmtClock(it.t1)}</Text>
                </View>
                <Text style={s.num}>{fmtDur(it.t1 - it.t0)}</Text>
              </TouchableOpacity>
            );
            if (it.type === 'gap') return (
              <View key={i} style={s.tl}>
                <View style={[s.tlIcon, { borderColor: C.line }]}><Feather name="slash" size={13} color={C.faint} /></View>
                <Text style={[s.dim, { flex: 1 }]}>Veri yok · {fmtClock(it.t0)} – {fmtClock(it.t1)}</Text>
              </View>
            );
            return (
              <TouchableOpacity key={i} style={s.tl} onPress={() => onTrip(it)}>
                <View style={[s.tlIcon, { borderColor: MODE[it.mode].color }]}><ModeIcon mode={it.mode} size={15} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.tx}>{MODE[it.mode].label} · {fmtKm(it.dist)}</Text>
                  <Text style={s.dim}>{fmtClock(it.t0)} – {fmtClock(it.t1)} · ort {fmtKmh(it.avg)}</Text>
                </View>
                <Text style={s.num}>{fmtDur(it.dur)}</Text>
                <Feather name="chevron-right" size={16} color={C.faint} />
              </TouchableOpacity>
            );
          }) : <Text style={s.dim}>Bu gün için kayıt yok</Text>}
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

function AnalizTab({ trk, hints, rev, onPlace }) {
  const [span, setSpan] = useState(7);
  const [off, setOff] = useState(0); // kaç dönem geriye
  const [open, setOpen] = useState(null); // açık rutin
  const [w, setW] = useState(0);
  const to = addDays(dayStart(Date.now()), 1 - off * span), from = addDays(to, -span);
  const data = useMemo(() => loadRange(from, to, trk.running, hints, true), [from, to, rev, trk.running]);
  const t = data.totals, maxPlace = Math.max(1, ...data.places.map((p) => p.total));
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
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
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
function AyarlarTab({ trk, onToggle, profile, setProfile, onWipe, rev }) {
  const st = useMemo(() => store.pointStats(), [rev, trk]);
  const perm = trk.bg ? ['Her zaman', C.ok] : trk.fg ? ['Yalnız kullanırken', C.warn] : ['İzin yok', C.bad];
  return (
    <ScrollView style={{ flex: 1, paddingTop: TOP }} contentContainerStyle={{ padding: 14, paddingBottom: 60 }}>
      <Text style={s.h1}>Ayarlar</Text>
      <Card title="KAYIT">
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: trk.running ? C.ok : C.bad }]} />
          <Text style={[s.tx, { flex: 1 }]}>{trk.running ? 'Konum kaydediliyor' : 'Kayıt durduruldu'}</Text>
          <TouchableOpacity style={[s.btn, !trk.running && { backgroundColor: C.accent, borderColor: C.accent }]} onPress={onToggle}>
            <Text style={[s.btnTx, !trk.running && { color: C.bg }]}>{trk.running ? 'Durdur' : 'Başlat'}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.row}>
          <Feather name="shield" size={15} color={perm[1]} />
          <Text style={[s.tx, { flex: 1 }]}>Konum izni: <Text style={{ color: perm[1] }}>{perm[0]}</Text></Text>
          <TouchableOpacity style={s.btn} onPress={() => Linking.openSettings()}><Text style={s.btnTx}>iOS Ayarları</Text></TouchableOpacity>
        </View>
        {!trk.bg ? <Text style={s.dim}>Kesintisiz kayıt için iOS Ayarları → Konum → «Her Zaman» seç. Aksi halde kayıt yalnız mavi konum göstergesi açıkken sürer.</Text> : null}
        <Text style={[s.dim, { marginTop: 6 }]}>Uygulamayı yukarı kaydırıp kapatma: iOS o zaman kaydı durdurur. Arka planda bırakman yeterli.</Text>
      </Card>
      <Card title="HASSASİYET">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Hassas" active={profile === 'hassas'} onPress={() => setProfile('hassas')} />
          <Chip label="Pil dostu" active={profile === 'pil'} onPress={() => setProfile('pil')} />
        </View>
        <Text style={[s.dim, { marginTop: 8 }]}>{profile === 'hassas' ? 'Her ~15 m’de bir nokta. Yaya / araba / metro ayrımı en doğru bu modda çalışır.' : 'Her ~40 m’de bir nokta, daha kaba konum. Pil az gider; kısa yürüyüşler kaçabilir.'}</Text>
      </Card>
      <Card title="VERİ">
        <View style={s.row}><Text style={[s.tx, { flex: 1 }]}>Kayıtlı nokta</Text><Text style={s.num}>{st.n}</Text></View>
        <View style={s.row}><Text style={[s.tx, { flex: 1 }]}>İlk kayıt</Text><Text style={s.num}>{st.first ? fmtDay(st.first) + ' ' + fmtClock(st.first) : '—'}</Text></View>
        <View style={s.row}><Text style={[s.tx, { flex: 1 }]}>Son kayıt</Text><Text style={s.num}>{st.last ? fmtDay(st.last) + ' ' + fmtClock(st.last) : '—'}</Text></View>
        <Text style={s.dim}>Tüm veriler yalnız bu telefonda saklanır; hiçbir sunucuya gönderilmez.</Text>
        <TouchableOpacity style={[s.btn, { borderColor: C.bad, marginTop: 10, alignSelf: 'flex-start' }]} onPress={onWipe}>
          <Text style={[s.btnTx, { color: C.bad }]}>Tüm veriyi sil</Text>
        </TouchableOpacity>
      </Card>
      <Text style={[s.dim, { textAlign: 'center' }]}>İZ · sürüm {VERSION}</Text>
    </ScrollView>
  );
}

// ===================== Yolculuk ayrıntısı =====================
function TripModal({ trip, onClose, onMode }) {
  if (!trip) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: TOP }}>
        <View style={s.modalHead}>
          <TouchableOpacity style={s.iconBtn} onPress={onClose}><Feather name="chevron-down" size={22} color={C.text} /></TouchableOpacity>
          <Text style={s.h2}>{fmtDay(trip.t0)} · {fmtClock(trip.t0)} – {fmtClock(trip.t1)}</Text>
        </View>
        <View style={{ height: 260 }}>
          <MapPane legs={tripLegs(trip)} stays={[]} fitKey={'trip' + trip.t0} pad={{ top: 40, right: 40, bottom: 40, left: 40 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 14 }}>
          <Card>
            <View style={s.statRow}>
              <Stat label="Mesafe" value={fmtKm(trip.dist)} />
              <Stat label="Süre" value={fmtDur(trip.dur)} />
              <Stat label="Ort. hız" value={fmtKmh(trip.avg)} />
              <Stat label="Tepe hız" value={fmtKmh(trip.max)} />
            </View>
          </Card>
          <Card title="PARÇALAR">
            {trip.legs.map((l, i) => (
              <View key={i} style={s.row}>
                <ModeIcon mode={l.mode} />
                <Text style={[s.tx, { width: 70 }]}>{MODE[l.mode].label}</Text>
                <Text style={[s.dim, { flex: 1 }]}>{fmtClock(l.t0)} – {fmtClock(l.t1)} · ort {fmtKmh(l.avg)}</Text>
                <Text style={s.num}>{fmtKm(l.dist)}</Text>
              </View>
            ))}
            <Text style={s.dim}>Tür, hızın 40 sn’lik ortalamasından çıkarılır. Metro: GPS’in kesildiği ve araç hızıyla geçilen bölüm (kesikli çizgi).</Text>
          </Card>
          <Card title="TÜR YANLIŞSA DÜZELT">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Otomatik" active={!trip.overridden} onPress={() => onMode(trip, null)} />
              {MODES.map((m) => <Chip key={m} label={MODE[m].label} color={MODE[m].color} active={trip.overridden && trip.mode === m} onPress={() => onMode(trip, m)} />)}
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
              <Text style={[s.btnTx, { color: C.bg }]}>Kaydet</Text>
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
  const [rev, setRev] = useState(0); // veri değişti sayacı (yeni nokta, ad/tür düzeltmesi)
  const [trk, setTrk] = useState({ fg: false, bg: false, running: false });
  const [profile, setProfileS] = useState(() => store.getKV('profile', 'hassas'));
  const [hints, setHints] = useState(() => store.getKV('hints', null));
  const [trip, setTrip] = useState(null);
  const [place, setPlace] = useState(null);
  const tried = useRef(new Set()); // adres sorgusu denenmiş yerler (aynı yeri tekrar tekrar sorma)
  const bump = useCallback(() => setRev((r) => r + 1), []);

  // Açılış: durum oku; kullanıcı kaydı açık bırakmışsa (yeniden kurulum / yeniden başlatma) sürdür.
  // Ayrıca son 14 günden ev/iş konumunu çıkar — tek günlük görünümler bu ipucunu kullanır.
  useEffect(() => {
    (async () => {
      let st = await tracker.status();
      if (!st.running && st.fg && store.getKV('rec', false)) st = await tracker.start(profile);
      setTrk(st);
    })();
    const to = addDays(dayStart(Date.now()), 1);
    const r = loadRange(addDays(to, -14), to, false, null, true);
    const pick = (k) => { const p = r.places.find((x) => x.kind === k && x.auto); return p ? { lat: p.lat, lon: p.lon } : null; };
    const h = { home: pick('home'), work: pick('work') };
    if (h.home || h.work) { store.setKV('hints', h); setHints(h); }
  }, []);

  // Ekran açıkken 30 sn'de bir ve uygulama öne gelince yenile.
  useEffect(() => {
    const id = setInterval(bump, 30e3);
    const sub = AppState.addEventListener('change', (a) => { if (a === 'active') { bump(); tracker.status().then(setTrk); } });
    return () => { clearInterval(id); sub.remove(); };
  }, []);

  const data = useMemo(() => loadRange(day, addDays(day, 1), trk.running, hints, false), [day, rev, trk.running, hints]);

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
    if (trk.running) { store.setKV('rec', false); setTrk(await tracker.stop()); return; }
    const st = await tracker.start(profile);
    setTrk(st);
    if (st.running) store.setKV('rec', true);
    else Alert.alert('Konum izni gerekli', 'Kayıt için iOS Ayarları → Konum bölümünden izin ver.', [{ text: 'Vazgeç' }, { text: 'Ayarları aç', onPress: () => Linking.openSettings() }]);
  };
  const setProfile = async (p) => {
    setProfileS(p); store.setKV('profile', p);
    if (trk.running) setTrk(await tracker.start(p)); // yeni hassasiyetle yeniden başlat
  };
  const onMode = (t, mode) => { store.setOverride(t.t0, mode); setTrip(null); bump(); };
  const onSavePlace = (p, name, kind) => {
    const id = p.saved ? p.saved.id : store.addPlace({ lat: p.lat, lon: p.lon, addr: p.addr });
    store.updatePlace(id, name, kind);
    setPlace(null); bump();
  };
  const onWipe = () => Alert.alert('Tüm veriyi sil', 'Kaydedilmiş bütün konumlar, yerler ve düzeltmeler silinir. Geri alınamaz.', [
    { text: 'Vazgeç' },
    { text: 'Sil', style: 'destructive', onPress: () => { store.wipeAll(); store.setKV('rec', trk.running); setHints(null); tried.current.clear(); bump(); } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        {tab === 'harita' ? <HaritaTab data={data} day={day} setDay={setDay} trk={trk} onToggle={onToggle} onPlace={setPlace} /> : null}
        {tab === 'gunluk' ? <GunlukTab data={data} day={day} setDay={setDay} onTrip={setTrip} onPlace={setPlace} /> : null}
        {tab === 'analiz' ? <AnalizTab trk={trk} hints={hints} rev={rev} onPlace={setPlace} /> : null}
        {tab === 'ayarlar' ? <AyarlarTab trk={trk} onToggle={onToggle} profile={profile} setProfile={setProfile} onWipe={onWipe} rev={rev} /> : null}
      </View>
      <View style={[s.nav, { paddingBottom: BOTTOM }]}>
        {TABS.map(([k, icon, label]) => (
          <TouchableOpacity key={k} style={s.navBtn} onPress={() => setTab(k)}>
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
  cardTitle: { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
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
  recTx: { color: C.text, fontSize: 12, fontWeight: '600' },
  overlayBottom: { position: 'absolute', left: 14, right: 14, bottom: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, gap: 10 },
  statRow: { flexDirection: 'row', gap: 10 },
  statV: { color: C.text, fontSize: 15, fontWeight: '700', ...mono },
  statL: { color: C.dim, fontSize: 11, marginTop: 1 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, backgroundColor: C.panel2 },
  modeChipTx: { color: C.text, fontSize: 13, fontWeight: '600', ...mono },
  tl: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  tlIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: C.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel2 },
  axis: { color: C.faint, fontSize: 10, textAlign: 'center' },
  barBg: { height: 4, borderRadius: 2, backgroundColor: C.panel2, marginVertical: 5 },
  barFg: { height: 4, borderRadius: 2, backgroundColor: C.accent },
  rtGrid: { flexDirection: 'row', marginTop: 8, gap: 8 },
  nav: { flexDirection: 'row', backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 },
  navBtn: { flex: 1, alignItems: 'center', gap: 3 },
  navTx: { color: C.dim, fontSize: 10, fontWeight: '600' },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 8 },
  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16 },
  input: { marginTop: 6, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: C.text, fontSize: 14, backgroundColor: C.bg },
});
