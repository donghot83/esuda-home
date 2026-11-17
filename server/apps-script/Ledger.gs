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

// 번호~무게(A~F)는 위치 고정. 로스·최종·금액·로스금액·메모는 2026-11-17부터 '머리글 이름'으로 찾는다(ledgerCols_) —
// 무게와 로스 사이에 '무상제외' 칸이 들어간 달(11월~)과 안 들어간 달(10월 이전)을 둘 다 처리.
var LEDGER_COL = { no: 1, date: 2, name: 3, area: 4, addr: 5, weight: 6, memo: 11 };   // memo 는 옛 모양 기본값 — 실제로는 ledgerCols_(sh).memo
var LEDGER_COLS_CACHE_ = [];
/** 장부 달 시트의 칸 위치(1부터) {weight, excl(없으면 0), loss, final, amount, lossAmt, memo} — 머리글(1행) 이름으로 */
function ledgerCols_(sh, v) {
  for (var k = 0; k < LEDGER_COLS_CACHE_.length; k++) if (LEDGER_COLS_CACHE_[k][0] === sh) return LEDGER_COLS_CACHE_[k][1];
  var h = ((v || sh.getDataRange().getValues())[0] || []).map(function (x) { return String(x == null ? '' : x).replace(/\s+/g, ''); });
  var at = function (name) { var i = h.indexOf(name); return i >= 0 ? i + 1 : 0; };
  var x = at('무상제외') ? 1 : 0;
  var c = { no: 1, date: 2, name: 3, area: 4, addr: 5, weight: 6, excl: x ? 7 : 0,
    loss: at('로스') || 7 + x, final: at('최종') || 8 + x, amount: at('금액') || 9 + x, lossAmt: at('로스금액') || 10 + x, memo: at('메모') || 11 + x,
    phone: at('연락처') };   // 2026-11-18 카톡 예약 연락처 칸(없으면 0)
  LEDGER_COLS_CACHE_.push([sh, c]);
  return c;
}
function ledgerColsReset_() { LEDGER_COLS_CACHE_ = []; }
function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

// 2026-11-16: 직원 줄과 같은 계산 — 최종 = 무게 - 무상제외 - 로스, 금액 = 최종×단가 - 로스×로스단가(최종 15kg 미만이면 '무상수거'), 로스금액 = 로스×로스단가
// 2026-11-17: 무상제외(박스·이불 등)는 무게에서만 빼고 돈은 공제하지 않음
function lossUnitPrice_() {
  var v = PropertiesService.getScriptProperties().getProperty('TRANSFER_LOSS_PRICE');
  return v ? +v : 200;
}
function ledgerFinalFormula_(row, c) {
  var F = 'F' + row, L = colLetter_(c.loss) + row, X = c.excl ? colLetter_(c.excl) + row : '';
  return '=IF(' + F + '="","",' + F + (X ? '-N(' + X + ')' : '') + '-N(' + L + '))';
}
function ledgerCalcFormulas_(row, c) {
  c = c || { excl: 0, loss: 7, final: 8 };
  var u = transferUnitPrice_(), lu = lossUnitPrice_(), F = 'F' + row, L = colLetter_(c.loss) + row, H = colLetter_(c.final) + row;
  return [[ledgerFinalFormula_(row, c),
           '=IF(' + F + '="","",IF(' + H + '>=15,' + H + '*' + u + '-N(' + L + ')*' + lu + ',"무상수거"))',
           '=IF(N(' + L + ')=0,"",' + L + '*' + lu + ')']];
}
function setLedgerCalc_(sh, row) { var c = ledgerCols_(sh); sh.getRange(row, c.final, 1, 3).setFormulas(ledgerCalcFormulas_(row, c)); }
/** 무상제외 칸에 값을 넣을 때: 그 줄 최종 수식이 무상제외를 안 빼고 있으면 표준 수식으로 (손으로 만든 다른 수식은 그대로) */
function ensureFinalFormula_(sh, row) {
  var c = ledgerCols_(sh);
  if (!c.excl) return false;
  var cur = String(sh.getRange(row, c.final).getFormula ? sh.getRange(row, c.final).getFormula() : '').replace(/\$/g, '');
  var X = colLetter_(c.excl) + row;
  if (cur && cur.indexOf(X) >= 0) return false;
  sh.getRange(row, c.final, 1, 1).setFormulas([[ledgerFinalFormula_(row, c)]]);
  return true;
}

/** 신청페이지 줄 중 계산 수식이 없는 줄에 수식 채우기 (지난달~두 달 뒤). 직원이 만든 줄은 건드리지 않음 */
function fillLedgerCalc() {
  var R = rules_(), today = R.todayKST(new Date()), done = {}, n = 0;
  [-31, 0, 31, 62].forEach(function (k) {
    var d0 = R.addDays(today, k), lss = ledgerOpen_(d0), sh = lss && ledgerMonthSheet_(lss, d0);
    if (!sh) return;
    var key = d0.slice(0, 4) + sh.getName();
    if (done[key]) return; done[key] = 1;
    var v = sh.getDataRange().getValues(), LC = ledgerCols_(sh, v);
    var f = sh.getRange(1, LC.final, v.length, 3).getFormulas();
    for (var i = 1; i < v.length; i++) {
      if (!/^ESD-\d{6}-\w{4} 신청페이지/.test(String(v[i][LC.memo - 1] || ''))) continue;
      if ((f[i] || []).join('')) continue;                                       // 이미 수식 있음
      if ([LC.final - 1, LC.amount - 1, LC.lossAmt - 1].some(function (j) { return v[i][j] !== '' && v[i][j] != null; })) continue; // 직원이 값을 직접 넣음
      setLedgerCalc_(sh, i + 1); n++;
    }
  });
  return n;
}
var LEDGER_GAP = 2; // 날짜 묶음 사이 빈 줄 수

/**
 * 장부 작업 전용 잠금 (2026-11-16): 5분 자동 반영·동선·취소가 장부를 오래 만지는 동안
 * 고객 신청(스크립트 잠금)이 기다리다 'busy'로 실패하던 문제 → 장부 작업은 문서 잠금으로 분리
 */
function ledgerLock_() { return LockService.getDocumentLock() || LockService.getScriptLock(); }

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
  var v = sh.getDataRange().getValues(), LC = ledgerCols_(sh, v);
  var ym = c.date.slice(0, 7);
  var last = -1, lastDate = '', firstAfter = -1;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][LC.memo - 1] || '').indexOf(rid) >= 0) return { ok: true, duplicate: true }; // 이미 들어감
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
    try { sh.getRange(last + 1, 1, 1, LC.memo).copyTo(sh.getRange(at, 1, 1, LC.memo), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) {}
  }
  var dc = sh.getRange(at, LEDGER_COL.date);
  dc.setValue(c.date); // 'YYYY-MM-DD' 글자 → 시트가 자기 시간대로 그날 날짜로 바꿈(시간대 차이로 하루 밀리지 않음)
  if (fmt) { try { dc.setNumberFormat(fmt); } catch (e) {} }
  sh.getRange(at, LEDGER_COL.name).setValue(c.name);
  sh.getRange(at, LEDGER_COL.area).setValue(ledgerArea_(c));
  sh.getRange(at, LEDGER_COL.addr).setValue(ledgerAddress_(c));
  sh.getRange(at, LC.memo).setValue(rid + ' 신청페이지 / ' + c.amount + (c.payNote ? ' / ' + c.payNote : '') + (c.memo ? ' / ' + c.memo : ''));
  try { setLedgerCalc_(sh, at); } catch (e) { logError_('장부 수식', e); }
  driverCacheClear_(c.date);
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
  driverCacheClear_(dateStr);
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
  var v = sh.getDataRange().getValues(), LC = ledgerCols_(sh, v);
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][LC.memo - 1] || '').indexOf(rid) >= 0) return { sheet: sh, row: i + 1, weight: v[i][LEDGER_COL.weight - 1], values: v };
  }
  return null;
}

/** 점검용: 장부(그 달 시트)에 예약번호가 있나 — 한 번 실행 안에서는 시트를 한 번만 읽음 */
var LEDGER_MEMO_CACHE_ = {};
function ledgerHasRid_(dateStr, rid) {
  var key = dateStr.slice(0, 7);
  if (!(key in LEDGER_MEMO_CACHE_)) {
    var lss = ledgerOpen_(dateStr), sh = lss && ledgerMonthSheet_(lss, dateStr);
    var vv = sh ? sh.getDataRange().getValues() : null, mc = sh ? ledgerCols_(sh, vv).memo : 0;
    LEDGER_MEMO_CACHE_[key] = sh ? vv.map(function (r) { return String(r[mc - 1] || ''); }).join('|') : null;
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
    var tz = lss.getSpreadsheetTimeZone() || 'GMT', v = sh.getDataRange().getValues(), LC = ledgerCols_(sh, v);
    for (var i = 1; i < v.length; i++) {
      var d = cellYmd_(v[i][LEDGER_COL.date - 1], tz);
      if (!d || d.slice(0, 7) !== ym || d < today) continue;
      if (!String(v[i][LEDGER_COL.name - 1] || '').trim()) continue;
      if (/^\[취소/.test(String(v[i][LC.memo - 1] || ''))) continue; // 취소 표시 줄은 자리 차지 안 함
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
  var lock = ledgerLock_();
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
  // 2026-11-17: 기사님 근무 시간(15시~새벽 4시)엔 오늘·내일 기사님 목록을 미리 만들어 둠 → 화면 열면 바로
  try { if (typeof warmDriverCache_ === 'function') warmDriverCache_(new Date()); } catch (e) { logError_('기사님 목록 미리 만들기', e); }
  try { if (typeof sendPendingPickups_ === 'function') sendPendingPickups_(new Date()); } catch (e) { logError_('픽업 완료 대기 발송', e); }
  try { if (typeof kakaoIntake_ === 'function') kakaoIntake_(new Date()); } catch (e) { logError_('카톡 예약 연락처 등록', e); }   // 2026-11-18
  return res;
}

/* ===== 2026-11-17 장부에 '무상제외' 칸 넣기 (메뉴, 한 번만) =====
 * 11월·12월 매입금액 시트의 무게(F) 오른쪽에 G '무상제외' 칸을 넣는다(로스 이하가 한 칸씩 오른쪽으로).
 * 구글 시트가 칸을 넣을 때 기존 수식을 자동으로 맞춰 줌 → 최종 수식만 '무게-무상제외-로스'로 바꿈.
 * 손으로 만든 다른 모양의 최종 수식(예: 금액에 -900)은 건드리지 않고 목록으로 알려 줌. 메모 칸에 '메모' 머리글.
 */
function addExclColumn_(ym) {
  var lss = ledgerOpen_(ym + '-01'), sh = lss && ledgerMonthSheet_(lss, ym + '-01');
  if (!sh) return { ym: ym, skipped: '시트 없음' };
  var c0 = ledgerCols_(sh);
  if (c0.excl) return { ym: ym, skipped: '이미 있음' };
  sh.insertColumnAfter(LEDGER_COL.weight);
  sh.getRange(1, LEDGER_COL.weight + 1).setValue('무상제외');
  ledgerColsReset_();
  var v = sh.getDataRange().getValues(), c = ledgerCols_(sh, v);
  if (!String(v[0][c.memo - 1] || '').trim()) { sh.getRange(1, c.memo).setValue('메모'); }
  ledgerColsReset_(); c = ledgerCols_(sh);
  var f = sh.getRange(1, c.final, v.length, 1).getFormulas(), changed = 0, odd = [];
  var Lc = colLetter_(c.loss);
  for (var i = 1; i < v.length; i++) {
    var cur = String((f[i] || [''])[0] || '').replace(/\$/g, '').replace(/\s+/g, ''), r = i + 1;
    if (!cur) continue;
    // 칸을 넣은 뒤 모양: =F12-H12  또는  =IF(F12="","",F12-N(H12))
    if (cur === '=F' + r + '-' + Lc + r || cur === '=IF(F' + r + '="","",F' + r + '-N(' + Lc + r + '))') {
      sh.getRange(r, c.final, 1, 1).setFormulas([[ledgerFinalFormula_(r, c)]]); changed++;
    } else if (cur.indexOf('G' + r) < 0) odd.push(r + '행');
  }
  return { ym: ym, changed: changed, odd: odd };
}
function addExclColumns() {
  var R = rules_(), today = R.todayKST(new Date());
  var yms = {}; yms[today.slice(0, 7)] = 1; yms[R.addDays(today, 31).slice(0, 7)] = 1;
  var lock = ledgerLock_();
  if (!lock.tryLock(20000)) return [{ error: 'busy' }];
  try { return Object.keys(yms).sort().map(addExclColumn_); }
  finally { lock.releaseLock(); ledgerColsReset_(); }
}
function menuAddExclColumns_() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('장부에 무상제외 칸 추가', '이번 달·다음 달 매입금액 시트의 무게 오른쪽에 「무상제외」 칸을 넣어요.\n로스·최종·금액·로스금액·메모는 한 칸씩 오른쪽으로 가요.\n\n직원이 장부를 고치고 있지 않을 때 눌러 주세요. 진행할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var r = addExclColumns();
  ui.alert(r.map(function (x) {
    if (x.error) return '잠시 뒤 다시 해 주세요 (다른 작업 중)';
    if (x.skipped) return x.ym + ': ' + x.skipped;
    return x.ym + ': 칸 추가 완료, 최종 수식 ' + x.changed + '줄 바꿈' + (x.odd.length ? '\n  ※ 모양이 달라 그대로 둔 최종 수식: ' + x.odd.slice(0, 15).join(', ') + (x.odd.length > 15 ? ' 외 ' + (x.odd.length - 15) + '줄' : '') : '');
  }).join('\n'));
}
