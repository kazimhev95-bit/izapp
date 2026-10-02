// Uygulama kilidi testi: Face ID döngüsü olmamalı.  ->  node test/lock.test.mjs
// App.js'teki akışın modeli: AppState olayları → kilit kararı → kilitlenince Face ID (pencere açılınca inactive,
// kapanınca active üretir). 1.0.19 kuralı kullanıcının telefonunda sonsuz döngüye girdi (olay günlüğü 1 Eki 19:36:26–38).
import { shouldLock, LOCK_GRACE } from '../src/lockrule.js';

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'OK   ' : 'FAIL ') + msg); if (!c) fail++; };

// rule(prev, next, bgAt, now, on) → kilitle mi; resetOnLock: kilitleyince/açılınca bgAt sıfırlanır mı
function sim(rule, resetOnLock, script) {
  const S = { prev: 'active', bgAt: 0, locked: false, on: false, t: 1.79e12, prompts: 0, faceOk: true }; // gerçek saat (t=0 "hiç arka plana gitmedi" sayılır)
  const prompt = () => {
    if (S.prompts > 20) return; // döngü: daha fazla sayma
    S.prompts++;
    emit('inactive');            // Face ID penceresi açıldı
    S.t += 1500;
    if (S.faceOk) { S.locked = false; if (resetOnLock) S.bgAt = 0; }
    emit('active');              // pencere kapandı
  };
  function emit(a) {
    if (a === 'background') S.bgAt = S.t;
    else if (rule(S.prev, a, S.bgAt, S.t, S.on)) { S.locked = true; if (resetOnLock) S.bgAt = 0; S.prev = a; prompt(); return; }
    S.prev = a;
  }
  script(S, emit, prompt);
  return S;
}
const OLD = (prev, a, bgAt, now, on) => on && a === 'active' && !!bgAt && now - bgAt > LOCK_GRACE; // 1.0.19
const at = (S, ms) => { S.t += ms; };

// Kullanıcının günü: uygulama daha önce 5 dk arkada kalmış (kilit kapalıyken), sonra Ayarlar'da kilidi açıyor
// (açarken bir kez Face ID — Ayarlar düğmesi), sonra uygulamada geziniyor.
const enableLock = (S, emit, prompt) => {
  emit('background'); at(S, 300e3); emit('active');  // 5 dk arka plan, kilit kapalı
  at(S, 10e3); S.on = true; prompt();                 // kilidi açarken doğrulama
  at(S, 20e3);                                        // uygulamada geziniyor
};
const o = sim(OLD, false, enableLock);
ok(o.prompts > 5, '1.0.19 kuralı döngüye giriyor (kanıt): ' + o.prompts + ' Face ID');
const n = sim(shouldLock, true, enableLock);
ok(n.prompts === 1, 'yeni kural: kilidi açınca yalnız 1 Face ID: ' + n.prompts);

// Gerçek dönüş: 40 sn arka planda kalıp dönünce bir kez sorar; 10 sn'lik bakışta sormaz
const back = sim(shouldLock, true, (S, emit, prompt) => { enableLock(S, emit, prompt); emit('background'); at(S, 40e3); emit('active'); });
ok(back.prompts === 2, '40 sn arka plandan dönüş: bir kez daha soruyor (toplam ' + back.prompts + ')');
const peek = sim(shouldLock, true, (S, emit, prompt) => { enableLock(S, emit, prompt); emit('background'); at(S, 10e3); emit('active'); });
ok(peek.prompts === 1, '10 sn bakıp dönünce sormuyor (toplam ' + peek.prompts + ')');

// Kontrol Merkezi / bildirim: yalnız inactive → active (arada arka plan yok) — kilitlemez
const cc = sim(shouldLock, true, (S, emit, prompt) => { enableLock(S, emit, prompt); for (let i = 0; i < 5; i++) { emit('inactive'); at(S, 60e3); emit('active'); } });
ok(cc.prompts === 1, 'Kontrol Merkezi / bildirim açıp kapamak kilitlemiyor (toplam ' + cc.prompts + ')');

// Face ID başarısız/iptal: kendiliğinden yeniden sormaz (kilit ekranındaki düğmeyle açılır) — iptal döngüsü yok
const cancel = sim(shouldLock, true, (S, emit, prompt) => { enableLock(S, emit, prompt); emit('background'); at(S, 40e3); S.faceOk = false; emit('active'); at(S, 5e3); emit('inactive'); emit('active'); });
ok(cancel.prompts === 2 && cancel.locked, 'iptal edilen Face ID yeniden kendiliğinden açılmıyor, kilit duruyor (toplam ' + cancel.prompts + ')');

// Kilit kapalıyken hiçbir zaman sormaz
const off = sim(shouldLock, true, (S, emit) => { emit('background'); at(S, 600e3); emit('active'); });
ok(off.prompts === 0, 'kilit kapalıyken sormuyor');

console.log(fail ? `\n${fail} HATA` : '\nTÜMÜ GEÇTİ');
process.exit(fail ? 1 : 0);
