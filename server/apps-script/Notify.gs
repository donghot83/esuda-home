/**
 * 수거 품목 사진 저장 + 직원 알림 메일
 *
 * 사진: 신청 페이지가 예약 확정 후 한 장씩 보낸다({action:'photo', reservationId, submissionId, index, data(base64 JPEG)}).
 *   - 예약번호와 제출ID가 맞는 예약에만, 최대 3장, 한 장 약 2MB 이하
 *   - 대표 구글 드라이브 '이수다 수거사진' 폴더(비공개)에 '예약번호_번호.jpg' 로 저장, 예약 시트 '사진' 칸에 링크
 *   - 목적: 수거 품목 확인·거래 증빙 (세무 증빙으로 보관)
 * 알림 메일: 스크립트 속성 NOTIFY_EMAILS (쉼표로 여러 개) 로 예약 확정 요약을 보낸다. 연락처·계좌는 넣지 않는다.
 */

var BOOK_EXTRA_HEADERS = ['사진방식', '사진'];
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
    '사진: ' + (c.photoMode || '-'),
    '요청사항: ' + (c.memo || '-'),
    '',
    '연락처·계좌·현관 비밀번호는 예약 시트에서 확인하세요.'
  ].join('\n');
  MailApp.sendEmail({ to: to, subject: subject, body: body });
  return true;
}

function R_dateLabel_(ymd) {
  var W = ['일', '월', '화', '수', '목', '금', '토'];
  var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)));
  return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)) + '(' + W[d.getUTCDay()] + ')';
}
