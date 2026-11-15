/**
 * 장부 자동 입력 — 확정된 예약을 구글 시트 장부의 "N월 매입금액" 시트 예약 칸에 날짜별로 넣는다.
 *
 * 장부 모양(현행 '이수다 현황(26년)'): A 번호 | B 날짜 | C 이름 | D 지역구 | E 주소 | F 무게 … | K 메모
 *  - 같은 날짜 예약은 붙여서, 날짜가 바뀌면 빈 줄 하나 띄우고 적는 기존 방식 그대로.
 *  - 무게·금액은 수거 후 직원이 적는다(여기서는 비워 둠).
 *  - 연락처·계좌·공동현관 비밀번호는 장부에 넣지 않는다(예약 시트에만 보관).
 *
 * 스크립트 속성 LEDGER_ID = 장부 스프레드시트 ID (시험 땐 장부 사본 ID). 없으면 장부 입력은 건너뛰고 '대기'로 둔다.
 * 해당 달 시트가 아직 없으면(예: 12월 시트 생성 전) '대기'로 두고, syncLedgerPending()이 나중에 다시 넣는다.
 */

var LEDGER_COL = { no: 1, date: 2, name: 3, area: 4, addr: 5, memo: 11 };

function ledgerMonthSheet_(ss, dateStr) {
  var m = +dateStr.slice(5, 7);
  var names = [m + '월 매입금액', m + '월매입금액', m + '월 매입입금', m + '월매입입금'];
  for (var i = 0; i < names.length; i++) { var sh = ss.getSheetByName(names[i]); if (sh) return sh; }
  return null;
}

/** 장부 '지역구' 칸: 서울은 구, 경기는 시 (고양시 덕양구 → '고양시', 김포시 → '김포시') */
function ledgerArea_(c) {
  var sg = String(c.sigungu || '').trim();
  return sg.split(' ')[0];
}

/** 장부 '주소' 칸: 도로명주소에서 시도·지역구 칸과 겹치는 앞부분을 빼고 상세주소를 붙인다 */
function ledgerAddress_(c) {
  var road = String(c.roadAddress || c.jibunAddress || '').trim();
  var parts = road.split(/\s+/);
  if (parts.length && /^(서울|경기|인천)/.test(parts[0])) parts.shift();
  var area = ledgerArea_(c);
  if (parts.length && parts[0] === area) parts.shift();
  return (parts.join(' ') + ' ' + String(c.addressDetail || '')).trim();
}

function cellYmd_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  var s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/**
 * 예약 1건을 장부에 넣는다. c = 예약 내용(확정된 것), rid = 예약번호
 * 반환 {ok:true, row} | {ok:true, duplicate:true} | {ok:false, reason:'no_ledger'|'no_month_sheet'}
 */
function ledgerAppend_(c, rid) {
  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_ID');
  if (!id) return { ok: false, reason: 'no_ledger' };
  var sh = ledgerMonthSheet_(SpreadsheetApp.openById(id), c.date);
  if (!sh) return { ok: false, reason: 'no_month_sheet' };
  var v = sh.getDataRange().getValues();
  var ym = c.date.slice(0, 7);
  var last = -1, lastDate = '', firstAfter = -1;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][LEDGER_COL.memo - 1] || '').indexOf(rid) >= 0) return { ok: true, duplicate: true }; // 이미 들어감
    var d = cellYmd_(v[i][LEDGER_COL.date - 1]);
    if (!d || d.slice(0, 7) !== ym) continue;            // 다른 달(아래쪽 월별 요약표 등)은 건너뜀
    if (d <= c.date) { last = i; lastDate = d; }
    else if (firstAfter < 0) firstAfter = i;
  }
  var blank = function (r) { // 0-based 행 r 의 A~E 가 비었나
    if (r >= v.length) return true;
    for (var k = 0; k < 5; k++) if (String(v[r][k] == null ? '' : v[r][k]).trim()) return false;
    return true;
  };
  var at; // 새 줄을 넣을 1-based 행 번호
  if (last >= 0 && lastDate === c.date) {            // 같은 날짜 묶음 끝에 붙이기
    sh.insertRowsAfter(last + 1, 1); at = last + 2;
  } else if (last >= 0) {                            // 앞 날짜 묶음 뒤: 빈 줄 하나 띄우고
    if (blank(last + 1)) { sh.insertRowsAfter(last + 2, 1); at = last + 3; }
    else { sh.insertRowsAfter(last + 1, 2); at = last + 3; }
  } else if (firstAfter >= 0) {                      // 이 달 첫 날짜보다 앞: 그 위에 넣고 빈 줄
    sh.insertRowsBefore(firstAfter + 1, 2); at = firstAfter + 1;
  } else {                                           // 이 달 시트가 비어 있음: 머리글 바로 아래
    sh.insertRowsAfter(1, 1); at = 2;
  }
  var y = +c.date.slice(0, 4), mo = +c.date.slice(5, 7), dd = +c.date.slice(8, 10);
  sh.getRange(at, LEDGER_COL.date).setValue(new Date(y, mo - 1, dd));
  sh.getRange(at, LEDGER_COL.name).setValue(c.name);
  sh.getRange(at, LEDGER_COL.area).setValue(ledgerArea_(c));
  sh.getRange(at, LEDGER_COL.addr).setValue(ledgerAddress_(c));
  sh.getRange(at, LEDGER_COL.memo).setValue(rid + ' 신청페이지 / ' + c.amount + (c.memo ? ' / ' + c.memo : ''));
  if (last >= 0) { // 날짜 칸 모양(예: 11/16(월)) 등 위 줄 서식 따라가기
    try { sh.getRange(last + 1, 1, 1, LEDGER_COL.memo).copyTo(sh.getRange(at, 1, 1, LEDGER_COL.memo), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) {}
  }
  return { ok: true, row: at };
}

/** 예약 시트의 한 행(배열) → 장부용 내용 */
function bookRowToClean_(hdr, row) {
  var g = function (h) { return row[hdr.indexOf(h)]; };
  return { date: fmtDate_(g('수거일')), name: String(g('이름') || ''), sigungu: String(g('시군구') || ''),
    roadAddress: String(g('도로명주소') || ''), jibunAddress: String(g('지번주소') || ''), addressDetail: String(g('상세주소') || ''),
    amount: String(g('수거양') || ''), memo: String(g('요청사항') || '') };
}

/** '대기' 예약을 장부에 다시 넣기 — 시간 트리거(예: 10분마다)로 실행. 반환 {added, waiting} */
function syncLedgerPending() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { added: 0, waiting: -1 };
  try {
    var sh = sheet_(SHEET_BOOK, BOOK_HEADERS);
    var data = sh.getDataRange().getValues(), hdr = data[0];
    var cSt = hdr.indexOf('확정상태'), cSync = hdr.indexOf('장부반영'), cAt = hdr.indexOf('장부반영시각'), cId = hdr.indexOf('예약번호');
    var added = 0, waiting = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cSt]) !== '확정' || String(data[i][cSync]) !== '대기') continue;
      var r = ledgerAppend_(bookRowToClean_(hdr, data[i]), String(data[i][cId]));
      if (r.ok) {
        sh.getRange(i + 1, cSync + 1).setValue('완료');
        sh.getRange(i + 1, cAt + 1).setValue(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'));
        if (!r.duplicate) added++;
      } else waiting++;
    }
    return { added: added, waiting: waiting };
  } finally { lock.releaseLock(); }
}
