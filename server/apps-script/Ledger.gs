/**
 * 장부 자동 입력 — 확정된 예약을 구글 시트 장부의 "N월 매입금액" 시트 예약 칸에 날짜별로 넣는다.
 *
 * 장부 모양(현행 '이수다 현황(26년)'): A 번호 | B 날짜 | C 이름 | D 지역구 | E 주소 | F 무게 … | K 메모
 *  - 같은 날짜 예약은 붙여서, 날짜가 바뀌면 빈 줄 두 칸 띄우고 적는다 (2026-11-15 대표 요청: 날짜 사이 2칸).
 *  - 날짜 칸 표시 모양(예: 11/16(월))은 그 시트에서 가장 많이 쓰는 모양을 따른다.
 *  - 무게·금액은 수거 후 직원이 적는다(여기서는 비워 둠).
 *  - 연락처·계좌·공동현관 비밀번호는 장부에 넣지 않는다(예약 시트에만 보관).
 *
 * 연도 넘김 (2026-11-15): 장부 파일은 1년에 1개('이수다 현황(26년)')이고 시트 이름에는 월만 있다.
 *  → 장부 연도와 다른 해의 예약(예: 2027년 1월)은 절대 이 파일에 넣지 않는다.
 *    스크립트 속성 LEDGER_ID_2027 처럼 그해 장부를 지정해 두면 그 파일에 넣고, 없으면 '대기'로 두고 매일 점검 메일로 알린다.
 *  - LEDGER_ID   = 올해 장부 ID, LEDGER_YEAR = 그 장부의 연도(없으면 2026)
 *  - LEDGER_ID_YYYY = 해당 연도 장부 ID (선택)
 * 해당 달 시트가 아직 없으면(예: 12월 시트 생성 전) '대기'로 두고, syncLedgerPending()이 나중에 다시 넣는다.
 */

var LEDGER_COL = { no: 1, date: 2, name: 3, area: 4, addr: 5, weight: 6, memo: 11 };
var LEDGER_GAP = 2; // 날짜 묶음 사이 빈 줄 수

/** 예약 날짜(YYYY-MM-DD)에 맞는 장부 파일 ID — 없으면 '' */
function ledgerIdFor_(dateStr) {
  var p = PropertiesService.getScriptProperties();
  var y = String(dateStr).slice(0, 4);
  var byYear = p.getProperty('LEDGER_ID_' + y);
  if (byYear) return byYear;
  var main = p.getProperty('LEDGER_ID');
  if (!main) return '';
  var ly = p.getProperty('LEDGER_YEAR') || '2026';
  return y === String(ly) ? main : '';
}

var LEDGER_CACHE_ = {};
function ledgerOpen_(dateStr) {
  var id = ledgerIdFor_(dateStr);
  if (!id) return null;
  if (!LEDGER_CACHE_[id]) LEDGER_CACHE_[id] = SpreadsheetApp.openById(id);
  return LEDGER_CACHE_[id];
}

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

// 장부 파일의 시간대(예: 가져온 파일은 GMT)로 날짜를 읽고 써야 하루 밀리지 않는다 (2026-11-15 실제 시험에서 발견)
function cellYmd_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz || 'Asia/Seoul', 'yyyy-MM-dd');
  var s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** 시트 날짜 칸에서 가장 많이 쓰는 표시 모양 (없으면 '') */
function ledgerDateFormat_(sh, v, tz) {
  try {
    var f = sh.getRange(1, LEDGER_COL.date, v.length, 1).getNumberFormats(), cnt = {}, best = '', n = 0;
    for (var i = 1; i < v.length; i++) {
      if (!cellYmd_(v[i][LEDGER_COL.date - 1], tz)) continue;
      var k = String((f[i] || [])[0] || '');
      if (!k || /^(General|@|yyyy-mm-dd|yyyy-MM-dd)$/i.test(k)) continue;
      cnt[k] = (cnt[k] || 0) + 1;
      if (cnt[k] > n) { n = cnt[k]; best = k; }
    }
    return best;
  } catch (e) { return ''; }
}

/**
 * 예약 1건을 장부에 넣는다. c = 예약 내용(확정된 것), rid = 예약번호
 * 반환 {ok:true, row} | {ok:true, duplicate:true} | {ok:false, reason:'no_ledger'|'no_year_ledger'|'no_month_sheet'}
 */
function ledgerAppend_(c, rid) {
  if (!PropertiesService.getScriptProperties().getProperty('LEDGER_ID')) return { ok: false, reason: 'no_ledger' };
  var lss = ledgerOpen_(c.date);
  if (!lss) return { ok: false, reason: 'no_year_ledger' };   // 다른 해 예약 → 올해 장부에 넣지 않음
  var tz = lss.getSpreadsheetTimeZone() || 'GMT'; // 가져온 파일은 시간대가 비어 있고 실제로는 GMT로 저장됨
  var sh = ledgerMonthSheet_(lss, c.date);
  if (!sh) return { ok: false, reason: 'no_month_sheet' };
  var v = sh.getDataRange().getValues();
  var ym = c.date.slice(0, 7);
  var last = -1, lastDate = '', firstAfter = -1;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][LEDGER_COL.memo - 1] || '').indexOf(rid) >= 0) return { ok: true, duplicate: true }; // 이미 들어감
    var d = cellYmd_(v[i][LEDGER_COL.date - 1], tz);
    if (!d || d.slice(0, 7) !== ym) continue;            // 다른 달(아래쪽 월별 요약표 등)은 건너뜀
    if (d <= c.date) { last = i; lastDate = d; }
    else if (firstAfter < 0) firstAfter = i;
  }
  var at; // 새 줄을 넣을 1-based 행 번호
  if (last >= 0 && lastDate === c.date) {            // 같은 날짜 묶음 끝에 붙이기
    sh.insertRowsAfter(last + 1, 1); at = last + 2;
  } else if (last >= 0) {                            // 앞 날짜 묶음 뒤: 빈 줄 2칸 띄우고 (뒤쪽 간격은 원래대로 유지)
    sh.insertRowsAfter(last + 1, LEDGER_GAP + 1); at = last + 2 + LEDGER_GAP;
  } else if (firstAfter >= 0) {                      // 이 달 첫 날짜보다 앞: 그 위에 넣고 빈 줄 2칸
    sh.insertRowsBefore(firstAfter + 1, LEDGER_GAP + 1); at = firstAfter + 1;
  } else {                                           // 이 달 시트가 비어 있음: 머리글 바로 아래
    sh.insertRowsAfter(1, 1); at = 2;
  }
  var fmt = ledgerDateFormat_(sh, v, tz);
  if (last >= 0) { // 위 줄 서식(글꼴·테두리 등) 따라가기
    try { sh.getRange(last + 1, 1, 1, LEDGER_COL.memo).copyTo(sh.getRange(at, 1, 1, LEDGER_COL.memo), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) {}
  }
  var dc = sh.getRange(at, LEDGER_COL.date);
  dc.setValue(c.date); // 'YYYY-MM-DD' 글자 → 시트가 자기 시간대로 그날 날짜로 바꿈(시간대 차이로 하루 밀리지 않음)
  if (fmt) { try { dc.setNumberFormat(fmt); } catch (e) {} }
  sh.getRange(at, LEDGER_COL.name).setValue(c.name);
  sh.getRange(at, LEDGER_COL.area).setValue(ledgerArea_(c));
  sh.getRange(at, LEDGER_COL.addr).setValue(ledgerAddress_(c));
  sh.getRange(at, LEDGER_COL.memo).setValue(rid + ' 신청페이지 / ' + c.amount + (c.payNote ? ' / ' + c.payNote : '') + (c.memo ? ' / ' + c.memo : ''));
  try { renumberLedgerDate_(sh, c.date, tz); } catch (e) {}
  bumpLedgerCount_(c.date, 1);
  return { ok: true, row: at };
}

/**
 * 그날 장부 줄 왼쪽(A열)에 1, 2, 3 … 번호 매기기 (2026-11-15 대표 요청: 몇 건인지 바로 보이게, 봉투 번호와 맞추기)
 * 이름이 있는 그날 줄을 위에서부터 순서대로. 지난 날짜는 건드리지 않음(오늘 이후만).
 */
function renumberLedgerDate_(sh, dateStr, tz) {
  if (!sh) return 0;
  var v = sh.getDataRange().getValues(), n = 0;
  for (var i = 1; i < v.length; i++) {
    if (cellYmd_(v[i][LEDGER_COL.date - 1], tz) !== dateStr) continue;
    if (!String(v[i][LEDGER_COL.name - 1] || '').trim()) continue;
    n++;
    if (String(v[i][LEDGER_COL.no - 1]) !== String(n)) sh.getRange(i + 1, LEDGER_COL.no).setValue(n);
  }
  return n;
}

/** 오늘부터 앞으로의 날짜 번호 전부 다시 매기기 (메뉴·설치용) */
function renumberUpcoming() {
  var R = rules_(), today = R.todayKST(new Date()), done = {}, count = 0;
  [0, 31, 62].forEach(function (k) {
    var d0 = R.addDays(today, k), lss = ledgerOpen_(d0), sh = lss && ledgerMonthSheet_(lss, d0);
    if (!sh || done[sh.getName()]) return; done[sh.getName()] = 1;
    var tz = lss.getSpreadsheetTimeZone() || 'GMT', dates = {};
    sh.getDataRange().getValues().forEach(function (r) { var d = cellYmd_(r[LEDGER_COL.date - 1], tz); if (d && d >= today) dates[d] = 1; });
    Object.keys(dates).forEach(function (d) { renumberLedgerDate_(sh, d, tz); count++; });
  });
  return count;
}

/** 장부에서 예약번호 줄 찾기 → {sheet, row(1-based), weight} | null */
function ledgerFind_(dateStr, rid) {
  var lss = ledgerOpen_(dateStr);
  if (!lss) return null;
  var sh = ledgerMonthSheet_(lss, dateStr);
  if (!sh) return null;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][LEDGER_COL.memo - 1] || '').indexOf(rid) >= 0) return { sheet: sh, row: i + 1, weight: v[i][LEDGER_COL.weight - 1], values: v };
  }
  return null;
}

/** 점검용: 장부(그 달 시트)에 예약번호가 있나 — 한 번 실행 안에서는 시트를 한 번만 읽음 */
var LEDGER_MEMO_CACHE_ = {};
function ledgerHasRid_(dateStr, rid) {
  var key = dateStr.slice(0, 7);
  if (!(key in LEDGER_MEMO_CACHE_)) {
    var lss = ledgerOpen_(dateStr), sh = lss && ledgerMonthSheet_(lss, dateStr);
    LEDGER_MEMO_CACHE_[key] = sh ? sh.getDataRange().getValues().map(function (r) { return String(r[LEDGER_COL.memo - 1] || ''); }).join('|') : null;
  }
  var t = LEDGER_MEMO_CACHE_[key];
  return t == null ? false : t.indexOf(rid) >= 0;
}

/** 장부 날짜별 줄 수(카톡·직원 입력 포함) — 하루 22건 계산용. 10분마다 새로 세서 저장 */
function refreshLedgerCounts_() {
  var R = rules_(), today = R.todayKST(new Date()), out = {};
  var months = {};
  for (var k = 0; k <= R.CONFIG.horizonDays; k += 10) months[R.addDays(today, k).slice(0, 7)] = 1;
  months[R.addDays(today, R.CONFIG.horizonDays).slice(0, 7)] = 1;
  Object.keys(months).forEach(function (ym) {
    var lss = ledgerOpen_(ym + '-01');
    if (!lss) return;
    var sh = ledgerMonthSheet_(lss, ym + '-01');
    if (!sh) return;
    var tz = lss.getSpreadsheetTimeZone() || 'GMT', v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var d = cellYmd_(v[i][LEDGER_COL.date - 1], tz);
      if (!d || d.slice(0, 7) !== ym || d < today) continue;
      if (!String(v[i][LEDGER_COL.name - 1] || '').trim()) continue;
      if (/^\[취소/.test(String(v[i][LEDGER_COL.memo - 1] || ''))) continue; // 취소 표시 줄은 자리 차지 안 함
      out[d] = (out[d] || 0) + 1;
    }
  });
  PropertiesService.getScriptProperties().setProperty('LEDGER_COUNTS', JSON.stringify({ at: Date.now(), counts: out }));
  return out;
}
function ledgerCounts_() {
  try { return (JSON.parse(PropertiesService.getScriptProperties().getProperty('LEDGER_COUNTS') || '{}').counts) || {}; }
  catch (e) { return {}; }
}
function bumpLedgerCount_(dateStr, n) {
  try {
    var p = PropertiesService.getScriptProperties(), o = JSON.parse(p.getProperty('LEDGER_COUNTS') || '{}');
    if (!o.counts) return;
    o.counts[dateStr] = Math.max(0, (o.counts[dateStr] || 0) + n);
    p.setProperty('LEDGER_COUNTS', JSON.stringify(o));
  } catch (e) {}
}

/** 예약 시트의 한 행(배열) → 장부용 내용 */
function bookRowToClean_(hdr, row) {
  var g = function (h) { return row[hdr.indexOf(h)]; };
  return { date: fmtDate_(g('수거일')), name: String(g('이름') || ''), sigungu: String(g('시군구') || ''),
    roadAddress: String(g('도로명주소') || ''), jibunAddress: String(g('지번주소') || ''), addressDetail: String(g('상세주소') || ''),
    amount: String(g('수거양') || ''), memo: String(g('요청사항') || ''),
    payNote: String(g('무상희망') || '') === '예' ? '무상 희망(계좌 없음)' : (String(g('계좌번호') || '').replace(/[^0-9]/g, '') ? '' : '계좌 없음') };
}

/** '대기' 예약을 장부에 다시 넣기 + 장부 줄 수·현황판 새로 고침 — 시간 트리거(10분마다). 반환 {added, waiting} */
function syncLedgerPending() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { added: 0, waiting: -1 };
  var res;
  try {
    var sh = sheet_(SHEET_BOOK, BOOK_HEADERS);
    var data = sh.getDataRange().getValues(), hdr = data[0];
    var cSt = hdr.indexOf('확정상태'), cSync = hdr.indexOf('장부반영'), cAt = hdr.indexOf('장부반영시각'), cId = hdr.indexOf('예약번호');
    var added = 0, waiting = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cSt]) !== '확정' || String(data[i][cSync]) !== '대기') continue;
      var r;
      try { r = ledgerAppend_(bookRowToClean_(hdr, data[i]), String(data[i][cId])); }
      catch (e) { r = { ok: false, reason: 'error' }; logError_('장부 다시 넣기', e); }
      if (r.ok) {
        sh.getRange(i + 1, cSync + 1).setValue('완료');
        sh.getRange(i + 1, cAt + 1).setValue(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'));
        if (!r.duplicate) added++;
      } else waiting++;
    }
    res = { added: added, waiting: waiting };
  } finally { lock.releaseLock(); }
  // 잠금 밖에서 (신청을 막지 않게, 2026-11-16)
  try { refreshLedgerCounts_(); } catch (e) { logError_('장부 줄 수 세기', e); }
  // 현황판은 무거워서 15분에 한 번 정도만 (실행 시간 한도 아끼기)
  var mm = new Date().getMinutes();
  if (res.added || mm % 15 < 5) { try { if (typeof refreshDashboard === 'function') refreshDashboard(); } catch (e) { logError_('현황판', e); } }
  return res;
}
