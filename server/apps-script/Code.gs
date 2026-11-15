/**
 * 이수다 수거 예약 서버 (Google Apps Script 웹 앱)
 *
 * 시트(같은 스프레드시트):
 *   예약   — 확정된 예약 1건 = 1행 (고객 정보·계좌 포함 → 시트 공유는 업무 담당자만)
 *   마감   — 직원이 닫는 날짜/기간  (시작일 | 종료일 | 구역(all/south/north) | 안내문구 | 메모)
 *   주말예외 — 대표가 여는 주말 날짜 (날짜 | 메모)
 *
 * 스크립트 속성(비밀값, 저장소에 넣지 않음):
 *   STAFF_TOKEN — 장부 반영 프로그램이 쓰는 비밀 토큰
 *
 * 공개 저장소이므로 이 파일에 고객 정보·토큰·시트 ID를 넣지 않는다.
 * Rules.gs = assets/apply-rules.js 복사본 (tools/sync_rules.py 로 갱신).
 */

var SHEET_BOOK = '예약';
var SHEET_CLOSE = '마감';
var SHEET_OPEN = '주말예외';

// 예약 시트 열 순서 (한 번 정하면 바꾸지 않는다: 장부 반영 프로그램이 이름으로 읽음)
var BOOK_HEADERS = ['예약번호', '확정상태', '장부반영', '장부반영시각', '수거일', '구역', '신청시각', '이름', '연락처',
  '시도', '시군구', '법정동', '우편번호', '도로명주소', '지번주소', '상세주소', '수거양', '놓을곳', '놓을곳상세',
  '공동현관', '공동현관비번', '요청사항', '은행', '계좌번호', '예금주', '제출ID', '출처'];

function rules_() { return (typeof ESUDA_RULES !== 'undefined') ? ESUDA_RULES : this.ESUDA_RULES; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) sh.appendRow(headers);
  }
  return sh;
}

function fmtDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(v || '').trim();
}

/** 마감·주말예외 읽기 (공개 가능한 정보만) */
function loadSchedule_() {
  var cl = sheet_(SHEET_CLOSE, ['시작일', '종료일', '구역', '안내문구', '메모']).getDataRange().getValues();
  var closures = [];
  for (var i = 1; i < cl.length; i++) {
    var s = fmtDate_(cl[i][0]);
    if (!s) continue;
    closures.push({ start: s, end: fmtDate_(cl[i][1]) || s, zone: String(cl[i][2] || 'all').trim() || 'all', message: String(cl[i][3] || '').trim() });
  }
  var op = sheet_(SHEET_OPEN, ['날짜', '메모']).getDataRange().getValues();
  var openDates = [];
  for (var j = 1; j < op.length; j++) { var d = fmtDate_(op[j][0]); if (d) openDates.push(d); }
  return { closures: closures, openDates: openDates };
}

/** 날짜별 확정 예약 수 {'YYYY-MM-DD': n} — 하루 한도 자동 마감용 (숫자만, 고객 정보 없음) */
function countsByDate_(data) {
  if (!data) data = sheet_(SHEET_BOOK, BOOK_HEADERS).getDataRange().getValues();
  var hdr = data[0] || [], cDate = hdr.indexOf('수거일'), cSt = hdr.indexOf('확정상태'), out = {};
  for (var i = 1; i < data.length; i++) {
    if (cSt >= 0 && String(data[i][cSt]) !== '확정') continue;
    var d = fmtDate_(data[i][cDate]);
    if (d) out[d] = (out[d] || 0) + 1;
  }
  return out;
}

function rand4_() {
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 4; i++) s += a.charAt(Math.floor(Math.random() * a.length));
  return s;
}

/** 공개 GET: ?action=schedule → 달력용 마감 정보 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'schedule') {
      var sc = loadSchedule_();
      var nowD = new Date();
      return json_({ ok: true, today: rules_().todayKST(nowD), hour: rules_().hourKST(nowD), closures: sc.closures, openDates: sc.openDates, counts: countsByDate_(), rulesVersion: rules_().CONFIG.version });
    }
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: 'server_error' });
  }
}

/** POST(text/plain JSON): {action:'submit', ...} | {action:'pending', token} | {action:'markSynced', token, ids:[...]} */
function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  try {
    if (body.action === 'submit') return json_(submit_(body));
    if (body.action === 'photo') return json_(photo_(body));
    if (body.action === 'pending') return json_(pending_(body.token));   // 토큰은 URL이 아니라 본문으로만
    if (body.action === 'markSynced') return json_(markSynced_(body.token, body.ids));
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: 'server_error' });
  }
}

/** 신청 저장 + 확정. 저장에 성공했을 때만 ok:true 를 돌려준다. */
function submit_(p) {
  var R = rules_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(SHEET_BOOK, BOOK_HEADERS);
    ensureBookHeaders_(sh, BOOK_EXTRA_HEADERS);
    var data = sh.getDataRange().getValues();
    var hdr = data[0];
    var cSub = hdr.indexOf('제출ID'), cId = hdr.indexOf('예약번호'), cDate = hdr.indexOf('수거일');
    // 같은 제출 재시도 → 기존 예약번호 그대로
    var sid = String(p.submissionId || '');
    for (var i = 1; i < data.length; i++) {
      if (sid && String(data[i][cSub]) === sid) {
        return { ok: true, duplicate: true, reservationId: String(data[i][cId]), date: fmtDate_(data[i][cDate]) };
      }
    }
    var sc = loadSchedule_();
    var nowD = new Date();
    var v = R.validateApplication(p, { today: R.todayKST(nowD), now: nowD, closures: sc.closures, openDates: sc.openDates, counts: countsByDate_(data) });
    if (!v.ok) return { ok: false, error: 'invalid', errors: v.errors };
    var c = v.clean;
    var ids = {};
    for (var k = 1; k < data.length; k++) ids[String(data[k][cId])] = true;
    var rid;
    do { rid = R.reservationId(c.date, rand4_()); } while (ids[rid]);
    var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    var row = {
      '예약번호': rid, '확정상태': '확정', '장부반영': '대기', '장부반영시각': '', '수거일': c.date, '구역': c.zone, '신청시각': now,
      '이름': c.name, '연락처': c.phone, '시도': c.sido, '시군구': c.sigungu, '법정동': c.bname, '우편번호': c.zonecode,
      '도로명주소': c.roadAddress, '지번주소': c.jibunAddress, '상세주소': c.addressDetail, '수거양': c.amount,
      '놓을곳': c.place, '놓을곳상세': c.placeDetail, '공동현관': c.entrance, '공동현관비번': c.entranceCode,
      '요청사항': c.memo, '은행': c.bank, '계좌번호': c.account, '예금주': c.holder, '제출ID': c.submissionId, '출처': '신청페이지',
      '사진방식': c.photoMode, '사진': ''
    };
    // 숫자로 바뀌지 않게(앞자리 0 보존) 문자열로 저장
    sh.appendRow(hdr.map(function (h) { var x = row[h]; return (h === '연락처' || h === '계좌번호' || h === '우편번호') ? "'" + x : (x === undefined ? '' : x); }));
    SpreadsheetApp.flush();
    // 장부 자동 입력 — 실패해도 예약은 확정 유지('대기'로 남고 syncLedgerPending 이 다시 시도)
    try {
      var lg = ledgerAppend_(c, rid);
      if (lg.ok) {
        var newRow = data.length + 1;
        sh.getRange(newRow, hdr.indexOf('장부반영') + 1).setValue('완료');
        sh.getRange(newRow, hdr.indexOf('장부반영시각') + 1).setValue(now);
      }
    } catch (err) { /* 장부 쪽 오류는 고객 응답에 영향 없음 */ }
    try { notifyBooking_(c, rid, (countsByDate_(data)[c.date] || 0) + 1); } catch (err) { /* 알림 실패는 예약에 영향 없음 */ }
    return { ok: true, duplicate: false, reservationId: rid, date: c.date };
  } finally {
    lock.releaseLock();
  }
}

function checkToken_(token) {
  var t = PropertiesService.getScriptProperties().getProperty('STAFF_TOKEN');
  return !!t && String(token || '') === t;
}

/** 장부 반영 대기 목록 (계좌는 내보내지 않음) */
function pending_(token) {
  if (!checkToken_(token)) return { ok: false, error: 'forbidden' };
  var data = sheet_(SHEET_BOOK, BOOK_HEADERS).getDataRange().getValues();
  var hdr = data[0], out = [];
  var keep = ['예약번호', '수거일', '구역', '신청시각', '이름', '시군구', '법정동', '도로명주소', '상세주소', '수거양', '놓을곳', '놓을곳상세', '공동현관', '요청사항'];
  for (var i = 1; i < data.length; i++) {
    if (data[i][hdr.indexOf('확정상태')] !== '확정' || data[i][hdr.indexOf('장부반영')] === '완료') continue;
    var o = {};
    keep.forEach(function (h) { var x = data[i][hdr.indexOf(h)]; o[h] = h === '수거일' ? fmtDate_(x) : x; });
    out.push(o);
  }
  return { ok: true, items: out };
}

function markSynced_(token, ids) {
  if (!checkToken_(token)) return { ok: false, error: 'forbidden' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(SHEET_BOOK, BOOK_HEADERS);
    var data = sh.getDataRange().getValues();
    var hdr = data[0], cId = hdr.indexOf('예약번호'), cSync = hdr.indexOf('장부반영'), cAt = hdr.indexOf('장부반영시각');
    var want = {}; (ids || []).forEach(function (x) { want[String(x)] = true; });
    var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'), n = 0;
    for (var i = 1; i < data.length; i++) {
      if (want[String(data[i][cId])] && data[i][cSync] !== '완료') {
        sh.getRange(i + 1, cSync + 1).setValue('완료');
        sh.getRange(i + 1, cAt + 1).setValue(now);
        n++;
      }
    }
    return { ok: true, updated: n };
  } finally {
    lock.releaseLock();
  }
}
