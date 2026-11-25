/**
 * 카카오 알림톡 (솔라피) — 2026-11-15 대표 결정: 솔라피로 진행
 *
 * 보내는 때
 *   ① 예약 완료  : 신청이 확정된 직후 (submit_)
 *   ② 픽업 완료  : 기사님 화면에서 [수거 완료]를 처음 누를 때 (신청페이지 예약만 — 연락처가 있는 예약)
 *                  기사님이 사진을 찍고 완료하면 TPL_PICKED_PHOTO([수거 사진 보기] 버튼, 변수 #{사진코드}) 로
 *   ③ 입금 예정  : 이체 파일을 만들 때 (makeTransferFile) — 2026-11-16 대표 결정: 예정 안내 후 송금
 *   ④ 무상수거   : 이체 파일 만들 때 15kg 미만으로 무상수거 표시되는 예약
 *   ⑤ 당일 안내  : 매일 오후 5시 30분 그날 수거할 신청페이지 예약에게 (서울 저녁 10시·일산·김포 저녁 7시~새벽 4시 방문, [준비 완료]·[채팅 문의] 버튼)
 *
 * 켜는 방법 (전부 스크립트 속성 — 비밀값은 대표님이 Apps Script '프로젝트 설정 → 스크립트 속성'에 직접 넣음, 저장소·로그에 남기지 않음)
 *   SOLAPI_KEY, SOLAPI_SECRET : 솔라피 콘솔 → API Key 관리
 *   SOLAPI_PFID               : 솔라피에 연결한 카카오채널 발신프로필 ID (KA01PF…)
 *   SOLAPI_FROM               : 솔라피에 등록한 발신번호 (알림톡 실패 시 문자로 대신 보낼 때)
 *   TPL_BOOKED / TPL_PICKED / TPL_PAID / TPL_FREE / TPL_SAMEDAY : 심사 통과한 템플릿 ID (KA01TP…) — 없는 종류는 안 보냄
 *   ALIMTALK_ON = 1           : 위가 다 준비된 뒤 켜는 스위치 (0 이나 없으면 아무것도 안 보냄)
 *   ALIM_CC = 대표 휴대폰번호   : (선택) 고객에게 간 알림톡을 같은 내용으로 이 번호에도 — 운영 초반 흐름 확인용. 지우면 꺼짐
 * 기록: 예약 서버 시트 '알림톡기록' 탭 (시각 | 종류 | 예약번호 | 받는번호 뒷4자리 | 결과) — 같은 예약·같은 종류는 한 번만 보냄
 */

var SHEET_ALIM = '알림톡기록';
var ALIM_KINDS = { booked: { prop: 'TPL_BOOKED', label: '예약 완료' }, picked: { prop: 'TPL_PICKED', label: '픽업 완료' },
  paid: { prop: 'TPL_PAID', label: '입금 예정' }, free: { prop: 'TPL_FREE', label: '무상수거' },
  sameday: { prop: 'TPL_SAMEDAY', label: '당일 안내' },
  pickedPhoto: { prop: 'TPL_PICKED_PHOTO', label: '픽업 완료(사진)', opt: true },
  paidPhoto: { prop: 'TPL_PAID_PHOTO', label: '입금 예정(사진)', opt: true }, // 2026-11-17 [계량 사진 보기] 버튼·로스 차감 줄
  // 2026-11-17 대표 문구: ③ 유상 매입 / ② 15kg 미만 무상(계근 사진) / ① 무상 희망(사진 없음)
  settle: { prop: 'TPL_SETTLE', label: '매입 정산', opt: true },
  freeUnder: { prop: 'TPL_FREE_UNDER', label: '무상수거(15kg 미만)', opt: true },
  freeWish: { prop: 'TPL_FREE_WISH', label: '무상수거(희망)', opt: true },
  // 2026-11-18 대표 결정: 무상제외·로스 줄은 있을 때만 보이게 → 경우별 템플릿 (TPL_SETTLE = 로스만 있는 경우)
  settleBase: { prop: 'TPL_SETTLE_BASE', label: '매입 정산(기본)', opt: true },
  settleExcl: { prop: 'TPL_SETTLE_EXCL', label: '매입 정산(무상제외)', opt: true },
  settleBoth: { prop: 'TPL_SETTLE_BOTH', label: '매입 정산(무상제외·로스)', opt: true },
  freeUnderExcl: { prop: 'TPL_FREE_UNDER_EXCL', label: '무상수거(15kg 미만·무상제외)', opt: true } };
var SETTLE_KINDS_ = ['paid', 'paidPhoto', 'settle', 'settleBase', 'settleExcl', 'settleBoth'];
var FREE_KINDS_ = ['free', 'freeUnder', 'freeUnderExcl', 'freeWish']; // 2026-11-16 [수거 사진 보기] 버튼 있는 픽업 완료

function alimConf_() {
  var p = PropertiesService.getScriptProperties();
  return { on: p.getProperty('ALIMTALK_ON') === '1', key: p.getProperty('SOLAPI_KEY'), secret: p.getProperty('SOLAPI_SECRET'),
    pfId: p.getProperty('SOLAPI_PFID'), from: p.getProperty('SOLAPI_FROM'), tpl: function (k) { return p.getProperty(ALIM_KINDS[k].prop) || ''; },
    cc: (function (v) { v = String(v || '').replace(/[^0-9]/g, ''); return /^01\d{8,9}$/.test(v) ? v : ''; })(p.getProperty('ALIM_CC')) };   // 2026-11-17 참관 번호(대표가 직접 넣음)
}

function alimSent_(kind, rid) {
  var sh = ss_().getSheetByName(SHEET_ALIM);
  if (!sh) return false;
  return sh.getDataRange().getValues().some(function (r) { return String(r[1]) === ALIM_KINDS[kind].label && String(r[2]) === rid && /^성공/.test(String(r[4])); });
}

function alimSentOn_(kind, rid, ymd) {
  var sh = ss_().getSheetByName(SHEET_ALIM);
  if (!sh) return false;
  return sh.getDataRange().getValues().some(function (r) {
    var at = r[0] instanceof Date || (r[0] && typeof r[0].getTime === 'function') ? Utilities.formatDate(r[0], 'Asia/Seoul', 'yyyy-MM-dd') : String(r[0]).slice(0, 10);
    return at === ymd && String(r[1]) === ALIM_KINDS[kind].label && String(r[2]) === rid && /^성공/.test(String(r[4]));
  });
}

function alimLog_(kind, rid, to, result) {
  try { sheet_(SHEET_ALIM, ['시각', '종류', '예약번호', '받는번호', '결과']).appendRow([Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'), ALIM_KINDS[kind].label, rid, '****' + String(to).slice(-4), String(result).slice(0, 200)]); } catch (e) {}
}

function solapiAuth_(key, secret) {
  var date = new Date().toISOString(), salt = Utilities.getUuid().replace(/-/g, '');
  var sig = Utilities.computeHmacSha256Signature(date + salt, secret)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return 'HMAC-SHA256 apiKey=' + key + ', date=' + date + ', salt=' + salt + ', signature=' + sig;
}

/** 알림톡 1건. kind = booked|picked|paid|free, vars = {'#{이름}': '…'} → {ok, skipped?, error?} */
function sendAlimtalk_(kind, rid, phone, vars) {
  var c = alimConf_(), to = String(phone || '').replace(/[^0-9]/g, '');
  if (!c.on) return { ok: false, skipped: 'off' };
  var tpl = c.tpl(kind);
  if (!c.key || !c.secret || !c.pfId || !tpl) return { ok: false, skipped: 'not_ready' };
  if (!/^01\d{8,9}$/.test(to)) return { ok: false, skipped: 'no_phone' };
  // 2026-11-23: 당일 안내는 '그날' 보낸 것만 중복으로 봄 — 날짜를 바꾼 예약은 바뀐 날에도 다시 나감
  if (kind === 'sameday' ? alimSentOn_(kind, rid, rules_().todayKST(new Date())) : alimSent_(kind, rid)) return { ok: true, skipped: 'already' };
  var msg = { to: to, kakaoOptions: { pfId: c.pfId, templateId: tpl, variables: vars, disableSms: !c.from } };
  if (c.from) msg.from = String(c.from).replace(/[^0-9]/g, '');
  try {
    var res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send-many/detail', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: solapiAuth_(c.key, c.secret) },
      payload: JSON.stringify({ messages: [msg] })
    });
    var code = res.getResponseCode(), body = res.getContentText();
    var j = {}; try { j = JSON.parse(body); } catch (e) {}
    var failed = (j.failedMessageList || []).length;
    if (code >= 200 && code < 300 && !failed) {
      alimLog_(kind, rid, to, '성공');
      // 2026-11-17 참관: 스크립트 속성 ALIM_CC 에 번호가 있으면 고객에게 간 알림톡을 같은 내용으로 그 번호에도 (흐름 파악용, 끄려면 속성 삭제)
      if (c.cc && c.cc !== to) {
        try {
          var cm = JSON.parse(JSON.stringify(msg)); cm.to = c.cc;
          var cr = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send-many/detail', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: { Authorization: solapiAuth_(c.key, c.secret) }, payload: JSON.stringify({ messages: [cm] }) });
          alimLog_(kind, rid, c.cc, cr.getResponseCode() < 300 ? '참관 성공' : '참관 실패 ' + cr.getResponseCode());
        } catch (e) { alimLog_(kind, rid, c.cc, '참관 실패 ' + e.message); }
      }
      return { ok: true };
    }
    alimLog_(kind, rid, to, '실패 ' + code + ' ' + (j.errorMessage || (j.failedMessageList && j.failedMessageList[0] && j.failedMessageList[0].statusMessage) || body.slice(0, 120)));
    return { ok: false, error: 'send_failed' };
  } catch (e) {
    alimLog_(kind, rid, to, '실패 ' + e.message);
    return { ok: false, error: 'send_failed' };
  }
}

/** ① 예약 완료 */
function alimBooked_(c, rid) {
  return sendAlimtalk_('booked', rid, c.phone, {
    '#{이름}': c.name, '#{예약번호}': shortRid_(rid), '#{수거일}': R_dateLabel_(c.date),
    '#{주소}': (String(c.roadAddress || c.jibunAddress || '') + ' ' + String(c.addressDetail || '')).trim()
  });
}

/** 예약 시트에서 예약번호 한 줄 → {get(h)} | null */
function bookRowByRid_(rid) {
  var b = bookData_();
  for (var i = 1; i < b.data.length; i++) if (String(b.data[i][b.col('예약번호')]) === rid) {
    var row = b.data[i];
    return { get: function (h) { var k = b.col(h); return k >= 0 ? String(row[k] == null ? '' : row[k]) : ''; },
      date: function (h) { var k = b.col(h); return k >= 0 ? fmtDate_(row[k]) : ''; } }; // 날짜 칸은 원래 값으로 (글자로 바꾸면 NaN)
  }
  return null;
}

/** ② 픽업 완료 (기사님 [수거 완료]) — 기사님이 사진을 올렸고 사진 템플릿이 있으면 [수거 사진 보기] 버튼 있는 것으로 */
function alimPicked_(rid) {
  var r = bookRowByRid_(rid);
  if (!r || r.get('확정상태') !== '확정') return { ok: false, skipped: 'no_booking' };
  if (alimSent_('picked', rid) || alimSent_('pickedPhoto', rid)) return { ok: true, skipped: 'already' };
  var vars = { '#{이름}': r.get('이름'), '#{예약번호}': shortRid_(rid) };
  if (alimConf_().tpl('pickedPhoto') && pickPhotos_(null, rid).length) {
    vars['#{사진코드}'] = pickPhotoCode_(rid, true);
    return sendAlimtalk_('pickedPhoto', rid, r.get('연락처'), vars);
  }
  return sendAlimtalk_('picked', rid, r.get('연락처'), vars);
}

/** ③ 입금 예정 / ④ 무상수거 — lr = 장부 줄 {weight, excl, loss}, amount = 입금액(0이면 무상), why = 'wish'(무상 희망)
 *  2026-11-17: 유상 매입 → TPL_SETTLE([계량 사진 보기]) / 15kg 미만 무상 → TPL_FREE_UNDER([계근 사진 보기]) / 무상 희망 → TPL_FREE_WISH(사진 없음)
 *  새 템플릿이 아직 없거나 계량 사진이 없으면 예전 템플릿으로 */
function alimSettled_(rid, lr, amount, why, noAcct) {
  var p = alimSettlePlan_(rid, lr, amount, why, noAcct);
  if (p.skip) return p.skip === 'already' ? { ok: true, skipped: 'already' } : { ok: false, skipped: p.skip };
  return sendAlimtalk_(p.kind, rid, p.phone, p.vars);
}

/** 정산 알림톡을 '무엇으로·누구에게·어떤 값으로' 보낼지 (보내지 않음) → {kind, phone, vars} | {skip}
 *  2026-11-18: 미리보기(정산 미리보기 메뉴)와 실제 발송이 같은 판단을 쓰도록 나눔 */
function alimSettlePlan_(rid, lr, amount, why, noAcct) {   // noAcct: 카톡 예약(계좌 없음, 따로 이체) — 계좌 줄 있는 입금 예정 템플릿은 못 씀
  var r = bookRowByRid_(rid);
  if (!r) return { skip: 'no_booking' };
  var w = Math.round(((+lr.weight || 0) - (+lr.excl || 0) - (+lr.loss || 0)) * 100) / 100;   // 정산 중량 = 무게 - 무상제외 - 로스
  var c = alimConf_(), hasPhoto = typeof weighPhotos_ === 'function' && weighPhotos_(null, rid, '계량').length > 0, ph = r.get('연락처');
  var plan = function (kind, vars) { return { kind: kind, phone: ph, vars: vars }; };
  var ex = Math.round((+lr.excl || 0) * 100) / 100, lo = Math.round((+lr.loss || 0) * 100) / 100, gross = Math.round((+lr.weight || 0) * 100) / 100;
  var logSh = ss_().getSheetByName(SHEET_ALIM), logV = logSh ? logSh.getDataRange().getValues() : [];
  var sent = function (ks) { var labs = ks.map(function (k) { return ALIM_KINDS[k].label; });
    return logV.some(function (x) { return String(x[2]) === rid && labs.indexOf(String(x[1])) >= 0 && /^성공/.test(String(x[4])); }); };
  if (amount > 0) {
    if (sent(SETTLE_KINDS_)) return { skip: 'already' };
    // 무상제외·로스가 있는지에 따라 그 줄이 있는 템플릿으로 (해당 템플릿이 아직 없으면 로스 줄 있는 TPL_SETTLE)
    var want = ex > 0 ? (lo > 0 ? 'settleBoth' : 'settleExcl') : (lo > 0 ? 'settle' : 'settleBase');
    var sk = c.tpl(want) ? want : (c.tpl('settle') ? 'settle' : '');
    if (sk && (hasPhoto || noAcct)) {
      return plan(sk, { '#{수거중량}': String(gross), '#{무상제외}': String(ex), '#{정산중량}': String(w), '#{매입단가}': String(transferUnitPrice_()),
        '#{로스}': String(lo), '#{로스금액}': Number(lo * lossUnitPrice_()).toLocaleString('ko-KR'), '#{매입금액}': Number(amount).toLocaleString('ko-KR'),
        '#{사진코드}': pickPhotoCode_(rid, true) });
    }
    if (noAcct) return { skip: 'settle_tpl' };   // 매입 정산 템플릿 승인 전 — 카톡 고객은 계좌 줄이 비게 되므로 안 보냄
    var vars = { '#{이름}': r.get('이름'), '#{수거일}': R_dateLabel_(r.date('수거일')),
      '#{무게}': String(w), '#{단가}': String(transferUnitPrice_()), '#{금액}': Number(amount).toLocaleString('ko-KR'),
      '#{은행}': r.get('은행'), '#{계좌끝4자리}': r.get('계좌번호').replace(/[^0-9]/g, '').slice(-4) };
    // 2026-11-17: 계량 사진이 있고 사진 템플릿이 있으면 [계량 사진 보기] 버튼·로스 차감 줄 있는 것으로
    if (c.tpl('paidPhoto') && typeof weighPhotos_ === 'function' && weighPhotos_(null, rid).length) {
      vars['#{로스}'] = String(+lr.loss || 0); vars['#{로스단가}'] = String(lossUnitPrice_()); vars['#{사진코드}'] = pickPhotoCode_(rid, true);
      return plan('paidPhoto', vars);
    }
    return plan('paid', vars);
  }
  if (sent(FREE_KINDS_)) return { skip: 'already' };
  if (why === 'wish') return c.tpl('freeWish') ? plan('freeWish', {}) : { skip: 'wish_tpl' };   // 문구에 변수 없음. 2026-11-18: 예전 무상수거 문구는 '15kg 미만이라 무상'이라 희망 고객에겐 안 맞음 → 템플릿 승인 전엔 안 보냄
  if (ex > 0 && c.tpl('freeUnderExcl') && hasPhoto) return plan('freeUnderExcl', { '#{수거중량}': String(gross), '#{무상제외}': String(ex), '#{정산중량}': String(w), '#{사진코드}': pickPhotoCode_(rid, true) });
  if (c.tpl('freeUnder') && hasPhoto) return plan('freeUnder', { '#{수거중량}': String(w), '#{사진코드}': pickPhotoCode_(rid, true) });
  return plan('free', { '#{이름}': r.get('이름'), '#{무게}': String(w) });
}

/* 정산 알림톡 템플릿 문구 사본 (미리보기용, 2026-11-18 솔라피 콘솔에서 복사) — 발송 API 키에 템플릿 읽기 권한이 없어서.
   새 템플릿을 연결하면 여기에도 문구를 추가해야 미리보기에 보임(없으면 솔라피에서 읽기를 시도). */
var ALIM_TEXTS_ = (function () {
  var HI = "안녕하세요.\n우리집 의류수거함 '이수다'입니다. 😊\n\n", ASK = '\n\n궁금한 점은 이 채팅방에 바로 메시지를 남겨 주세요.';
  var PH = function (n) { return [n, 'https://esuda.kr/photo/?c=#{사진코드}']; }, CHAT = ['채팅 문의', 'https://pf.kakao.com/_DxoHVG/chat'];
  var VALUE = "\n\n'이수다'에 보내주신 가치\n👕 티셔츠 한 장 = 물 2,700L 절약 효과 💧\n👖 청바지 한 벌 = 소나무 11그루 심는 효과 🌲\n\n🌍 오늘도 지구를 위해, 우리를 위해 💚";
  var PAIDHEAD = "안녕하세요.\n우리집 의류수거함 '이수다'예요 😃\n\n#{이름}님이 #{수거일}에 보내주신 의류는 아래와 같이 매입 금액을 적용하여 계좌로 입금될 예정이에요.\n다음에도 우리집 의류수거함 '이수다'를 이용해 주세요. 감사합니다 😁\n\n✔ 매입 정산 중량: #{무게}kg\n✔ 기본 매입금액: 1kg당 #{단가}원\n";
  var SETTLE = HI + '고객님의 의류 매입 정산이 완료되었습니다.\n\n✔ 정산 중량 : #{정산중량}kg\n✔ 매입 단가 : #{매입단가}원/kg\n✔ 로스(폐기물) 차감 : #{로스}kg (#{로스금액}원)\n✔ 총 매입금액 : #{매입금액}원\n\n매입금액은 신청하신 계좌로 입금될 예정입니다.\n센터에서 무게를 잰 사진은 아래 [계량 사진 보기]에서 확인하실 수 있어요.\n\n이수다를 이용해 주셔서 감사합니다.';
  var UNDER = HI + '고객님의 의류는 15kg 미만으로 확인되어 무상수거 처리되었습니다.\n\n✔ 수거 중량 : #{수거중량}kg\n\n센터에서 무게를 잰 사진은 아래 [계근 사진 보기]에서 확인하실 수 있어요.\n\n보내주신 옷들은 소중히 활용하겠습니다. 💚';
  var SET0 = HI + '고객님의 의류 매입 정산이 완료되었습니다.\n\n', EXN = '\n\n무상제외(박스·이불 등)는 매입 무게에서만 빼고, 금액을 따로 차감하지 않아요.';
  var SETT = '\n\n매입금액은 신청하신 계좌로 입금될 예정입니다.\n센터에서 무게를 잰 사진은 아래 [계량 사진 보기]에서 확인하실 수 있어요.\n\n이수다를 이용해 주셔서 감사합니다.' + ASK;
  var WISH = HI +'고객님의 의류가 무상수거 완료되었습니다.\n\n보내주신 소중한 옷들은 새로운 쓰임을 찾을 수 있도록 잘 활용하겠습니다. 💚\n\n이수다를 이용해 주셔서 감사합니다.';
  return {
    KA01TP261118031356707w2I7x2NMJTb: { c: SETTLE + ASK, b: [PH('계량 사진 보기')] },                             // 매입 정산 v6
    KA01TP261117075748184zBAwnfhofVB: { c: SETTLE + '\n다음에도 또 이용해 주세요! 💚', b: [PH('계량 사진 보기'), CHAT] },   // 매입 정산 v4
    KA01TP261118060032973K3LTDQL140P: { c: SET0 + '✔ 정산 중량 : #{정산중량}kg\n✔ 매입 단가 : #{매입단가}원/kg\n✔ 총 매입금액 : #{매입금액}원' + SETT, b: [PH('계량 사진 보기')] },   // 매입 정산 v7 기본
    KA01TP261118060034171HLPz3sSgYXk: { c: SET0 + '✔ 수거 중량 : #{수거중량}kg\n✔ 무상제외 : #{무상제외}kg\n✔ 정산 중량 : #{정산중량}kg\n✔ 매입 단가 : #{매입단가}원/kg\n✔ 총 매입금액 : #{매입금액}원' + EXN + SETT, b: [PH('계량 사진 보기')] },   // v7 무상제외
    KA01TP261118060034926pCKqWPcTf2b: { c: SET0 + '✔ 수거 중량 : #{수거중량}kg\n✔ 무상제외 : #{무상제외}kg\n✔ 로스(폐기물) 차감 : #{로스}kg (#{로스금액}원)\n✔ 정산 중량 : #{정산중량}kg\n✔ 매입 단가 : #{매입단가}원/kg\n✔ 총 매입금액 : #{매입금액}원' + EXN + SETT, b: [PH('계량 사진 보기')] },   // v7 무상제외·로스
    KA01TP261118060035893cs4BMGokFGH: { c: HI + '고객님의 의류는 매입 제외 물품을 뺀 중량이 15kg 미만으로 확인되어 무상수거 처리되었습니다.\n\n✔ 수거 중량 : #{수거중량}kg\n✔ 무상제외 : #{무상제외}kg\n✔ 정산 중량 : #{정산중량}kg\n\n센터에서 무게를 잰 사진은 아래 [계근 사진 보기]에서 확인하실 수 있어요.\n\n보내주신 옷들은 소중히 활용하겠습니다. 💚' + ASK, b: [PH('계근 사진 보기')] },   // 무상수거 안내 v6 (무상제외)
    KA01TP261118031357499CLeAts8S1ST: { c: UNDER + ASK, b: [PH('계근 사진 보기')] },                              // 무상수거 안내 v5
    KA01TP261117075747420kDYbmVTTUgV: { c: UNDER + '\n다음에도 이수다를 이용해 주세요!', b: [PH('계근 사진 보기'), CHAT] },  // 무상수거 안내 v3
    KA01TP261118031358284rBDNkqYYD1e: { c: WISH + ASK, b: [] },                                                  // 무상수거 완료 v3
    KA01TP261117075746646IoChQc9gwSX: { c: WISH + '\n다음에도 또 이용해 주세요!', b: [CHAT] },                     // 무상수거 완료 v1
    KA01TP261117061935984z2fAGP6mpE1: { c: PAIDHEAD + '✔ 로스(매입 제외) 차감: #{로스}kg (1kg당 #{로스단가}원)\n✔ 총 매입금액: #{금액}원\n✔ 입금 계좌: #{은행} ****#{계좌끝4자리}\n\n센터에서 무게를 잰 사진과 로스 사진은 아래 [계량 사진 보기]에서 확인하실 수 있어요.' + VALUE, b: [PH('계량 사진 보기'), CHAT] },   // 입금 예정 v3
    KA01TP261116061757625TcwQGLIAjHG: { c: PAIDHEAD + '✔ 총 매입금액: #{금액}원\n✔ 입금 계좌: #{은행} ****#{계좌끝4자리}' + VALUE, b: [CHAT] },   // 입금 예정 v2
    KA01TP26111604474703285toHNnWydV: { c: "안녕하세요.\n우리집 의류수거함 '이수다'입니다 😊\n\n#{이름}님, 아쉽지만 보내주신 의류는 15kg 미만으로\n이번에는 무상 수거로 처리되었어요 😢\n\n⚖ 수거 중량: #{무게}kg\n\n그래도 보내주신 소중한 옷들, 지구를 위해 의미 있게 잘 쓰겠습니다!\n다음에도 꼭 다시 이용해 주세요 🙏\n\n💡 보내주신 옷의 가치\n👕 티셔츠 한 장 = 물 2,700L 절약 효과 💧\n👖 청바지 한 벌 = 소나무 11그루 심는 효과 🌲\n\n🌍 오늘도 지구를 위해, 우리를 위해 💚", b: [CHAT] },   // 무상수거 안내 v2
    KA01TP261115074409047jLLadaXaK1F: { c: '[이수다] 수거 결과 안내\n\n#{이름}님, 최종 무게 #{무게}kg으로 15kg 미만이라 무상수거로 처리됐어요.\n소중한 옷을 맡겨 주셔서 감사합니다.', b: [] }   // 무상수거 안내 v1
  };
})();

/** 템플릿 문구·버튼 (미리보기용) → {content, buttons:[{name, link}]} | null — 사본 먼저, 없으면 솔라피에서 */
function solapiTemplate_(id) {
  var known = ALIM_TEXTS_[id];
  if (known) return { content: known.c, status: '', buttons: known.b.map(function (x) { return { name: x[0], link: x[1] }; }) };
  var c = alimConf_();
  if (!id || !c.key || !c.secret) return null;
  try {
    var res = UrlFetchApp.fetch('https://api.solapi.com/kakao/v2/templates/' + encodeURIComponent(id), { muteHttpExceptions: true, headers: { Authorization: solapiAuth_(c.key, c.secret) } });
    if (res.getResponseCode() >= 300) return null;
    var j = JSON.parse(res.getContentText());
    return { content: String(j.content || ''), status: String(j.status || ''), buttons: (j.buttons || []).map(function (b) { return { name: b.buttonName, link: b.linkMo || '' }; }) };
  } catch (e) { return null; }
}
function fillVars_(s, vars) { return String(s || '').replace(/#\{[^}]+\}/g, function (k) { return vars[k] != null ? vars[k] : k; }); }

/** 알림톡 준비 상태 (점검 메일·메뉴용) — 비밀값은 '있음/없음'만 */
function alimStatus_() {
  var c = alimConf_(), miss = [];
  if (!c.key || !c.secret) miss.push('API 키');
  if (!c.pfId) miss.push('카카오채널 연결(PFID)');
  Object.keys(ALIM_KINDS).forEach(function (k) { if (!c.tpl(k) && !ALIM_KINDS[k].opt) miss.push(ALIM_KINDS[k].label + ' 템플릿'); });
  return { on: c.on, missing: miss };
}

/** ⑤ 당일 안내 — 오늘 수거할 확정 예약(신청페이지) 전부. 트리거: 매일 17:30 (setupSameDay). 반환 {sent, skipped, failed} */
function sendSameDayNotices() {
  var R = rules_(), today = R.todayKST(new Date()), b = bookData_(), out = { sent: 0, skipped: 0, failed: 0 };
  for (var i = 1; i < b.data.length; i++) {
    var row = b.data[i], g = function (h) { var k = b.col(h); return k >= 0 ? String(row[k] == null ? '' : row[k]) : ''; };
    if (g('확정상태') !== '확정' || fmtDate_(row[b.col('수거일')]) !== today) continue;
    var rid = g('예약번호');
    var r = sendAlimtalk_('sameday', rid, g('연락처'), {
      '#{이름}': g('이름'), '#{예약번호}': shortRid_(rid),
      '#{주소}': ((g('도로명주소') || g('지번주소')) + ' ' + g('상세주소')).trim()
    });
    if (r.ok && !r.skipped) out.sent++; else if (r.ok || r.skipped) out.skipped++; else out.failed++;
  }
  return out;
}

/** 당일 안내 트리거 설치 (한 번만 실행) — 매일 오후 5시 30분쯤 */
function setupSameDay() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendSameDayNotices') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendSameDayNotices').timeBased().everyDays(1).atHour(17).nearMinute(30).inTimezone('Asia/Seoul').create();
  return 'ok';
}
