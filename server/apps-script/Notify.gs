/**
 * 수거 품목 사진 저장 + 직원 알림 메일
 *
 * 사진: 신청 페이지가 예약 확정 후 한 장씩 보낸다({action:'photo', reservationId, submissionId, index, data(base64 JPEG)}).
 *   - 예약번호와 제출ID가 맞는 예약에만, 최대 3장, 한 장 약 2MB 이하
 *   - 대표 구글 드라이브 '이수다 수거사진' 폴더(비공개)에 '예약번호_번호.jpg' 로 저장, 예약 시트 '사진' 칸에 링크
 *   - 목적: 수거 품목 확인·거래 증빙 (세무 증빙으로 보관)
 * 알림 메일: 스크립트 속성 NOTIFY_EMAILS (쉼표로 여러 개) 로 예약 확정 요약을 보낸다. 연락처·계좌는 넣지 않는다.
 */

var BOOK_EXTRA_HEADERS = ['사진방식', '사진', '무상희망'];
var PHOTO_FOLDER_NAME = '이수다 수거사진';
var PHOTO_MAX_B64 = 2800000; // base64 글자 수 (약 2MB)

/** 예약 시트 끝에 필요한 머리글이 없으면 붙인다. 반환: 머리글 배열 */
function ensureBookHeaders_(sh, extra) {
  var hdr = sh.getDataRange().getValues()[0] || [];
  extra.forEach(function (h) { if (hdr.indexOf(h) < 0) { sh.getRange(1, hdr.length + 1).setValue(h); hdr.push(h); } });
  return hdr;
}

function photoFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', f.getId());
  return f;
}

/** 사진 한 장 저장. 반환 {ok, url} | {ok:false, error} */
function photo_(b) {
  var rid = String(b.reservationId || ''), sid = String(b.submissionId || ''), idx = +b.index;
  var data = String(b.data || '').replace(/^data:image\/\w+;base64,/, '');
  if (!/^ESD-\d{6}-[A-Z0-9]{4}$/.test(rid) || !sid) return { ok: false, error: 'bad_request' };
  if (!(idx >= 1 && idx <= 3)) return { ok: false, error: 'too_many' };
  if (!data || data.length > PHOTO_MAX_B64) return { ok: false, error: 'too_large' };
  // 2026-11-16: 잠금 없이 확인·파일 저장 → 시트 한 칸 쓸 때만 잠금 (다른 신청을 막지 않게)
  var sh = sheet_(SHEET_BOOK, BOOK_HEADERS);
  var v = sh.getDataRange().getValues(), hdr = v[0] || [];
  if (hdr.indexOf('사진') < 0) hdr = ensureBookHeaders_(sh, BOOK_EXTRA_HEADERS);
  var cId = hdr.indexOf('예약번호'), cSub = hdr.indexOf('제출ID'), cPh = hdr.indexOf('사진'), row = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][cId]) === rid) { row = i; break; }
  if (row < 0) return { ok: false, error: 'not_found' };
  if (String(v[row][cSub]) !== sid) return { ok: false, error: 'forbidden' };   // 신청한 화면에서만 올릴 수 있음
  var name = rid + '_' + idx + '.jpg';
  if (String(v[row][cPh] || '').indexOf(name) >= 0) return { ok: true, duplicate: true };
  var file = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', name));
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: true, url: file.getUrl(), note: 'saved_without_link' };
  try {
    var cell = sh.getRange(row + 1, cPh + 1), prev = String(cell.getValue() || '');
    if (prev.indexOf(name) < 0) cell.setValue((prev ? prev + '\n' : '') + name + ' ' + file.getUrl());
    return { ok: true, url: file.getUrl() };
  } finally { lock.releaseLock(); }
}
function notifyBooking_(c, rid, countThatDay) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS');
  if (!to) return false;
  var d = R_dateLabel_(c.date);
  var subject = '[이수다 새 예약] ' + d + ' ' + ledgerArea_(c) + ' · ' + c.name + ' · ' + c.amount;
  var body = [
    '예약번호: ' + rid,
    '수거일: ' + d + ' (이날 장부 포함 ' + countThatDay + '건 / 한도 ' + rules_().CONFIG.dailyCap + '건)',
    '동네: ' + c.sigungu + ' ' + c.bname,
    '수거양: ' + c.amount,
    '놓을 곳: ' + c.place + (c.placeDetail ? ' (' + c.placeDetail + ')' : ''),
    '사진: ' + (c.photoMode || '-') + (c.photoIds && c.photoIds.length ? ' (' + c.photoIds.length + '장 접수)' : ''),
    '요청사항: ' + (c.memo || '-'),
    '',
    '연락처·계좌·현관 비밀번호는 예약 시트에서 확인하세요.'
  ].join('\n');
  MailApp.sendEmail({ to: to, subject: subject, body: body });
  return true;
}

function R_dateLabel_(ymd) {
  var W = ['일', '월', '화', '수', '목', '금', '토'];
  ymd = fmtDate_(ymd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd; // 이상한 값이면 그대로 (NaN 표시 방지)
  var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)));
  return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)) + '(' + W[d.getUTCDay()] + ')';
}

/* ===== 사진 미리 올리기 (2026-11-16) — 고객이 사진을 고르는 즉시 저장, 신청할 때 예약에 연결 ===== */
var SHEET_PREPHOTO = '사진대기';
function photoPre_(b) {
  var sid = String(b.submissionId || ''), data = String(b.data || '').replace(/^data:image\/\w+;base64,/, '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(sid)) return { ok: false, error: 'bad_request' };
  if (!data || data.length > PHOTO_MAX_B64) return { ok: false, error: 'too_large' };
  var sh = sheet_(SHEET_PREPHOTO, ['시각', '제출ID', '파일ID', '주소', '연결']);
  var n = sh.getDataRange().getValues().filter(function (r) { return String(r[1]) === sid; }).length;
  if (n >= 6) return { ok: false, error: 'too_many' };
  var file = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', 'pre_' + sid.slice(0, 12) + '_' + (n + 1) + '.jpg'));
  sh.appendRow([Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'), sid, file.getId(), file.getUrl(), '']);
  return { ok: true, id: file.getId() };
}
/** 신청 때: 같은 제출ID로 미리 올린 사진만 예약에 연결 → '사진' 칸 글자 */
function photoAttach_(sid, ids, rid) {
  if (!ids || !ids.length) return { text: '', count: 0 };
  var sh = ss_().getSheetByName(SHEET_PREPHOTO);
  if (!sh) return { text: '', count: 0 };
  var v = sh.getDataRange().getValues(), lines = [], k = 0;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][1]) !== String(sid) || ids.indexOf(String(v[i][2])) < 0) continue;
    k++; lines.push(rid + '_' + k + '.jpg ' + v[i][3]);
    sh.getRange(i + 1, 5).setValue(rid);
  }
  return { text: lines.join('\n'), count: k };
}
/** 매일: 하루 지난 연결 안 된 사진은 휴지통(신청 안 하고 나간 경우) + 연결된 사진 이름을 예약번호로 */
function tidyPrePhotos_() {
  var sh = ss_().getSheetByName(SHEET_PREPHOTO);
  if (!sh) return 0;
  var v = sh.getDataRange().getValues(), cut = Utilities.formatDate(new Date(Date.now() - 864e5), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'), n = 0, seq = {};
  var del = [];
  for (var i = 1; i < v.length; i++) { // 올린 순서대로 번호
    var linked = String(v[i][4] || '');
    try {
      if (!linked && String(v[i][0]) < cut) { DriveApp.getFileById(String(v[i][2])).setTrashed(true); del.push(i + 1); n++; }
      else if (linked && !/^이름변경/.test(linked)) {
        seq[linked] = (seq[linked] || 0) + 1;
        DriveApp.getFileById(String(v[i][2])).setName(linked + '_' + seq[linked] + '.jpg');
        sh.getRange(i + 1, 5).setValue('이름변경 ' + linked);
      }
    } catch (e) {}
  }
  for (var j = del.length - 1; j >= 0; j--) sh.deleteRow(del[j]);
  return n;
}

/* ===== 고객 '준비 완료' (2026-11-16) — 당일 알림톡 [준비 완료] 버튼 → esuda.kr/ready/?id=예약번호 → 여기 =====
 * 예약 시트 '준비완료' 칸에 시각을 적는다. 기사님 화면에 '✓ 준비완료'로 보인다. 돌려주는 값에 개인정보 없음.
 */
function ready_(b) {
  var rid = String(b && b.reservationId || '').toUpperCase().trim();
  if (/^\d{4}-[A-Z0-9]{4}$/.test(rid)) rid = resolveRid_(rid) || rid;   // 2026-11-17: 알림톡 버튼이 짧은 번호(1118-4829)로 옴
  if (!/^ESD-\d{6}-[A-Z0-9]{4}$/.test(rid)) return { ok: false, error: /^\d{4}-[A-Z0-9]{4}$/.test(rid) ? 'not_found' : 'bad_id' };
  var sh = sheet_(SHEET_BOOK, BOOK_HEADERS), hdr = ensureBookHeaders_(sh, ['준비완료']);
  var data = sh.getDataRange().getValues(), cId = hdr.indexOf('예약번호'), cSt = hdr.indexOf('확정상태'), cR = hdr.indexOf('준비완료'), cD = hdr.indexOf('수거일');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][cId]) !== rid) continue;
    if (String(data[i][cSt]) !== '확정') return { ok: false, error: 'not_active' };
    var date = fmtDate_(data[i][cD]);
    if (String(data[i][cR] || '')) return { ok: true, already: true, date: date };
    sh.getRange(i + 1, cR + 1).setNumberFormat('@').setValue(Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM-dd HH:mm'));   // 글자로(날짜로 바뀌지 않게)
    driverCacheClear_(date);
    return { ok: true, date: date };
  }
  return { ok: false, error: 'not_found' };
}

/* ===== 짧은 예약번호 (2026-11-17) — 고객에게는 1118-4829, 안쪽은 ESD-261118-4829 그대로 ===== */
function shortRid_(rid) { return rules_().shortId(rid); }
/** 'ESD-…' 또는 '1118-4829' → 예약번호 (짧은 번호는 예약 시트에서 찾음, 여러 해 겹치면 가장 최근) | '' */
function resolveRid_(input) {
  var s = String(input || '').toUpperCase().trim();
  if (/^ESD-\d{6}-[A-Z0-9]{4}$/.test(s)) return s;
  if (!/^\d{4}-[A-Z0-9]{4}$/.test(s)) return '';
  var b = bookData_(), c = b.col('예약번호'), hit = '';
  for (var i = 1; i < b.data.length; i++) { var r = String(b.data[i][c]); if (r.slice(6) === s) hit = r; }
  return hit;
}
/** 직원용 예약 찾기: 이름 / 연락처 뒤 4자리 / 짧은 번호 / 예약번호 → [{rid, short, date, name, area, status}] (최근 것 먼저, 20개) */
function findBookings_(q) {
  q = String(q || '').trim();
  if (!q) return [];
  var b = bookData_(), out = [], qd = q.replace(/[^0-9]/g, ''), rid = resolveRid_(q);
  for (var i = b.data.length - 1; i >= 1 && out.length < 20; i--) {
    var r = b.data[i], g = function (h) { var k = b.col(h); return k >= 0 ? String(r[k] == null ? '' : r[k]) : ''; };
    var id = g('예약번호'), tel = g('연락처').replace(/[^0-9]/g, '');
    var hit = rid ? id === rid : (g('이름').indexOf(q) >= 0 || (qd.length === 4 && q.length <= 5 && tel.slice(-4) === qd));
    if (hit) out.push({ rid: id, short: shortRid_(id), date: fmtDate_(r[b.col('수거일')]), name: g('이름'), area: g('시군구'), status: g('확정상태') });
  }
  return out;
}
function menuFindBooking_() {
  var ui = SpreadsheetApp.getUi();
  var p = ui.prompt('예약 찾기', '이름, 연락처 뒤 4자리, 예약번호(1118-4829) 중 하나를 넣어 주세요.', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var list = findBookings_(p.getResponseText());
  ui.alert(list.length ? list.map(function (x) { return x.short + '  ' + R_dateLabel_(x.date) + '  ' + x.name + ' (' + x.area + ')  ' + x.status; }).join('\n') +
    '\n\n취소하려면 메뉴 「예약 취소」에 앞의 번호(예: ' + list[0].short + ')를 넣으면 돼요.' : '찾는 예약이 없어요. (신청페이지 예약만 찾아요. 카톡 예약은 장부에서 확인)');
}
