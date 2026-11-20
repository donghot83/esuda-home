/**
 * 운영 도우미 (2026-11-15 대표 요청)
 *  1) 현황판: 예약 서버 시트 맨 앞 '현황' 탭 — 앞으로 3주 날짜별 예약 수·남은 자리·신청 화면 상태 (10분마다 자동 갱신)
 *  2) 매일 점검 메일: 매일 18시 대표 지메일로 "이상 없음 / 확인 필요" 보고 (홀짝 규칙·주말·마감·장부 반영·연도·오류)
 *  3) 예약 취소: 메뉴 '이수다 → 예약 취소' — 예약번호 하나로 예약 시트와 장부를 같이 처리
 *  4) 마감·주말예외 탭 모양 정리 (구역은 드롭다운: 전체 / 남쪽(홀수일) / 북쪽(짝수일))
 *
 * 개인정보: 메일·현황판에는 연락처·계좌·주소를 넣지 않는다(이름과 지역구까지만).
 */

var SHEET_DASH = '현황';
var ZONE_LABEL = { south: '홀수일 · 한강 남쪽·김포', north: '짝수일 · 한강 북쪽·일산·덕양' };
var REASON_LABEL = { ok: '받는 중', weekend: '주말 휴무', closed: '마감', full: '꽉 참(자동 마감)', cutoff: '오늘 접수 끝(17시)', past: '지남', horizon: '-', invalid: '-', parity: '-', lead: '-' };

function dayLabel_(ymd) { return R_dateLabel_(ymd); }

function bookData_() {
  var sh = sheet_(SHEET_BOOK, BOOK_HEADERS);
  var data = sh.getDataRange().getValues(), hdr = data[0] || [];
  return { sh: sh, data: data, hdr: hdr, col: function (h) { return hdr.indexOf(h); } };
}

/** 점검 — {issues:[문장], ok:[문장], pending:[{rid,date,why}], tomorrow:{date, n, byArea}} */
function runChecks_() {
  var R = rules_(), now = new Date(), today = R.todayKST(now);
  var b = bookData_(), sc = loadSchedule_(), counts = countsByDate_(b.data);
  var issues = [], ok = [], pending = [], seen = {};
  var cId = b.col('예약번호'), cDate = b.col('수거일'), cSt = b.col('확정상태'), cSync = b.col('장부반영'), cZone = b.col('구역'), cAt = b.col('신청시각'), cPh = b.col('사진'), cSrc = b.col('출처');
  var bad = { parity: [], weekend: [], closed: [], lost: [], cancelLeft: [] }, todayNew = 0, kakaoNew = 0, photos = 0, upcoming = 0;
  for (var i = 1; i < b.data.length; i++) {
    var r = b.data[i], rid = String(r[cId]), d = fmtDate_(r[cDate]), st = String(r[cSt]);
    // 2026-11-18: 카톡·직원 예약(장부 연락처로 등록)은 직원이 정한 날짜라 신청 규칙 점검에서 빼고 따로 셈
    if (String(r[cSrc] || '') === '카톡·직원') { if (ymd10_(r[cAt]) === today) kakaoNew++; continue; }
    if (ymd10_(r[cAt]) === today) { todayNew++; if (String(r[cPh] || '')) photos++; }
    if (!d || d < today) continue;
    if (st === '취소') {
      try { var cf = ledgerFindEntry_({ rid: rid, date: d }); if (cf && !cf.cancelled) bad.cancelLeft.push(rid); } catch (e) {}
      continue;
    }
    if (st !== '확정') continue;
    upcoming++;
    var day = +d.slice(8, 10), z = String(r[cZone]);
    if ((z === 'south' && day % 2 === 0) || (z === 'north' && day % 2 === 1)) bad.parity.push(rid + ' (' + dayLabel_(d) + ')');
    var wd = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, day)).getUTCDay();
    if (R.CONFIG.closedWeekdays.indexOf(wd) >= 0 && sc.openDates.indexOf(d) < 0) bad.weekend.push(rid + ' (' + dayLabel_(d) + ')');
    var cl = R.closureFor(d, z, sc.closures);
    // 2026-11-17: 오늘 날짜 '예약 마감'은 새 신청만 막는 것 — 이미 잡힌 오늘 예약은 그대로 수거하므로 경고하지 않음
    if (cl && d > today) bad.closed.push(rid + ' (' + dayLabel_(d) + (cl.message ? ' · ' + cl.message : '') + ')');
    if (String(r[cSync]) !== '완료') {
      var why = !ledgerIdFor_(d) ? d.slice(0, 4) + '년 장부가 아직 연결 안 됨'
        : '장부에 ' + (+d.slice(5, 7)) + '월 시트가 없거나 잠시 못 열었음 (10분마다 다시 시도)';
      try { var l = ledgerOpen_(d); if (l && ledgerMonthSheet_(l, d)) why = '다음 10분 자동 반영 때 들어갈 예정'; } catch (e) {} // (5분 주기여도 같은 문구로 판별)
      pending.push({ rid: rid, date: d, why: why });
    } else {
      try { if (ledgerOpen_(d) && !ledgerHasRid_(d, rid)) bad.lost.push(rid + ' (' + dayLabel_(d) + ')'); } catch (e) {}
    }
  }
  if (bad.parity.length) issues.push('홀짝 규칙과 다른 날짜의 예약 ' + bad.parity.length + '건: ' + bad.parity.join(', '));
  else ok.push('홀짝 규칙: 남쪽=홀수일, 북쪽=짝수일 모두 맞음 (앞으로 예약 ' + upcoming + '건 확인)');
  if (bad.weekend.length) issues.push('주말 예약 ' + bad.weekend.length + '건: ' + bad.weekend.join(', '));
  else ok.push('주말 예약 없음');
  if (bad.closed.length) issues.push('마감 탭에 넣은 날짜에 이미 잡힌 예약 ' + bad.closed.length + '건 — 고객께 날짜 변경 연락 필요: ' + bad.closed.join(', '));
  else ok.push('마감일에 걸린 예약 없음');
  var waitReal = pending.filter(function (p) { return !/다음 10분/.test(p.why); });
  if (waitReal.length) issues.push('장부에 아직 안 들어간 예약 ' + waitReal.length + '건: ' + waitReal.map(function (p) { return p.rid + ' (' + p.why + ')'; }).join(', '));
  else ok.push('신청페이지 예약이 모두 장부에 들어감');
  if (bad.lost.length) issues.push('장부에서 줄이 사라진 예약 ' + bad.lost.length + '건 (직원이 지웠다면 메뉴 "예약 취소"로 처리해 주세요): ' + bad.lost.join(', '));
  if (bad.cancelLeft.length) issues.push('취소했는데 장부에 취소 표시가 없는 예약 (메뉴 "예약 취소"로 다시 처리해 주세요): ' + bad.cancelLeft.join(', '));
  var over = Object.keys(counts).filter(function (d) { return d >= today && counts[d] > R.CONFIG.dailyCap; }).sort();
  if (over.length) issues.push('하루 ' + R.CONFIG.dailyCap + '건 넘은 날: ' + over.map(function (d) { return dayLabel_(d) + ' ' + counts[d] + '건'; }).join(', ') + ' (직원이 따로 추가한 거면 괜찮음)');
  else ok.push('하루 ' + R.CONFIG.dailyCap + '건 넘은 날 없음 (카톡·직원 입력 포함)');
  // 앞으로 받을 달의 장부 시트·연도 장부 준비 상태
  var months = {}, endD = R.addDays(today, R.CONFIG.horizonDays);
  for (var k = 0; k <= R.CONFIG.horizonDays; k += 7) months[R.addDays(today, k).slice(0, 7)] = 1;
  months[endD.slice(0, 7)] = 1;
  Object.keys(months).sort().forEach(function (ym) {
    var d1 = ym + '-01', y = ym.slice(0, 4), m = +ym.slice(5, 7);
    if (!ledgerIdFor_(d1)) {
      if (!seen['y' + y]) { seen['y' + y] = 1; issues.push(y + '년 예약도 받기 시작했어요(달력 ' + R.CONFIG.horizonDays + '일). ' + y + '년 장부를 만들면 연결해야 해요 — 그때까지 ' + y + '년 예약은 장부 대신 예약 시트에만 있고, 이 메일로 계속 알려 드려요.'); }
      return;
    }
    try { var l = ledgerOpen_(d1); if (l && !ledgerMonthSheet_(l, d1)) issues.push('장부에 "' + m + '월 매입금액" 시트가 아직 없어요. 만들어 두면 ' + m + '월 예약이 자동으로 들어가요.'); } catch (e) {}
  });
  // 서버 오류(최근 24시간)
  var errs = 0;
  try {
    var ev = ss_().getSheetByName('오류');
    if (ev) { var cut = Utilities.formatDate(new Date(now.getTime() - 864e5), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
      ev.getDataRange().getValues().slice(1).forEach(function (x) { if (String(x[0]) >= cut) errs++; }); }
  } catch (e) {}
  if (errs) issues.push('최근 24시간 서버 오류 ' + errs + '건 (예약 서버 시트 "오류" 탭)'); else ok.push('서버 오류 없음');
  // 자동 반영 장치가 살아 있나
  var trig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncLedgerPending'; });
  if (!trig) issues.push('10분 자동 반영 장치가 꺼져 있어요');
  // 내일(다음 수거일) 요약
  var next = R.addDays(today, 1), byArea = {}, n = 0;
  for (var j = 1; j < b.data.length; j++) {
    var rr = b.data[j];
    if (String(rr[cSt]) !== '확정' || fmtDate_(rr[cDate]) !== next) continue;
    n++; var a = ledgerArea_({ sigungu: rr[b.col('시군구')] }); byArea[a] = (byArea[a] || 0) + 1;
  }
  return { issues: issues, ok: ok, pending: pending, today: today, todayNew: todayNew, kakaoNew: kakaoNew, photos: photos, counts: counts,
    tomorrow: { date: next, page: n, total: counts[next] || 0, byArea: byArea } };
}

/** 현황판 '현황' 탭 새로 쓰기 (10분마다 + 메뉴) */
function refreshDashboard() {
  var R = rules_(), now = new Date(), today = R.todayKST(now), sc = loadSchedule_();
  var b = bookData_(), all = countsByDate_(b.data), page = pageCountsByDate_(b.data, false);
  var ss = ss_(), sh = ss.getSheetByName(SHEET_DASH);
  if (!sh) { sh = ss.insertSheet(SHEET_DASH, 0); }
  var chk; try { chk = runChecks_(); } catch (e) { chk = { issues: ['점검 실패: ' + e.message], ok: [] }; }
  var rows = [];
  for (var k = 0; k < 21; k++) {
    var d = R.addDays(today, k), day = +d.slice(8, 10), zone = day % 2 === 1 ? 'south' : 'north';
    var r = R.checkDate(d, zone, { today: today, now: now, closures: sc.closures, openDates: sc.openDates, counts: all });
    var st = REASON_LABEL[r.reason] || r.reason;
    if (r.reason === 'closed' && r.message) st += ' · ' + r.message;
    var wd = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, day)).getUTCDay();
    var weekend = R.CONFIG.closedWeekdays.indexOf(wd) >= 0 && sc.openDates.indexOf(d) < 0;
    rows.push([d, ['일', '월', '화', '수', '목', '금', '토'][wd], weekend ? '휴무' : ZONE_LABEL[zone], all[d] || 0, page[d] || 0,
      weekend ? '' : Math.max(0, R.CONFIG.dailyCap - (all[d] || 0)), st]);
  }
  sh.clear();
  sh.getRange(1, 1).setValue('이수다 수거 예약 현황').setFontSize(14).setFontWeight('bold');
  sh.getRange(1, 4).setValue('자동 갱신 ' + Utilities.formatDate(now, 'Asia/Seoul', 'MM/dd HH:mm') + ' (10분마다)').setFontColor('#666666');
  var head = chk.issues.length ? '⚠️ 확인 필요 ' + chk.issues.length + '건 — 아래 점검 내용 확인' : '✅ 점검 이상 없음';
  sh.getRange(2, 1).setValue(head).setFontWeight('bold').setFontColor(chk.issues.length ? '#c62828' : '#2e7d32');
  var H = ['날짜', '요일', '수거 구역', '전체 예약(장부 포함)', '신청페이지', '남은 자리(' + R.CONFIG.dailyCap + '건 기준)', '신청 화면'];
  sh.getRange(4, 1, 1, H.length).setValues([H]).setFontWeight('bold').setBackground('#e8f5e9');
  sh.getRange(5, 1, rows.length, H.length).setValues(rows);
  for (var i = 0; i < rows.length; i++) {
    var bg = rows[i][2] === '휴무' ? '#eeeeee' : (rows[i][6] === '받는 중' ? '#ffffff' : '#fff3e0');
    sh.getRange(5 + i, 1, 1, H.length).setBackground(bg);
  }
  var y = 5 + rows.length + 1;
  var cl = [];
  for (var cd = 0; cd < 21; cd++) { var dd = R.addDays(today, cd); cancelsFor_(dd).forEach(function (c) { cl.push(['❌ ' + dayLabel_(dd) + ' ' + c.no + '번 ' + c.name + ' (' + c.area + ') — ' + c.at + ' 취소']); }); }
  sh.getRange(y, 1).setValue('취소된 예약 (장부엔 빨간 취소선, 번호 그대로)').setFontWeight('bold').setFontColor('#c62828');
  if (cl.length) sh.getRange(y + 1, 1, cl.length, 1).setValues(cl).setFontColor('#c62828');
  else sh.getRange(y + 1, 1).setValue('없음');
  y += Math.max(cl.length, 1) + 2;
  sh.getRange(y, 1).setValue('점검 내용').setFontWeight('bold');
  var lines = chk.issues.map(function (s) { return ['⚠️ ' + s]; }).concat(chk.ok.map(function (s) { return ['✅ ' + s]; }));
  if (lines.length) sh.getRange(y + 1, 1, lines.length, 1).setValues(lines);
  y += lines.length + 2;
  sh.getRange(y, 1).setValue('사용법').setFontWeight('bold');
  sh.getRange(y + 1, 1, 4, 1).setValues([
    ['· 어떤 날을 닫으려면: "마감" 탭에 시작일·종료일·구역을 적으면 신청 화면에서 바로 닫혀요.'],
    ['· 주말에 받으려면: "주말예외" 탭에 날짜를 적어요.'],
    ['· 고객이 취소하면: 메뉴 이수다 → 예약 취소 → 예약번호 또는 "11/16 3"(날짜 번호). 장부 줄은 빨간 취소선, 번호는 그대로, 기사님 화면에도 바로 표시.'],
    ['· "전체 예약"은 장부 줄 수(카톡·직원 입력 포함)라서 22건이 차면 신청 화면에서 그날이 자동으로 닫혀요.']
  ]);
  sh.setFrozenRows(4);
  sh.setColumnWidth(1, 100); sh.setColumnWidth(2, 50); sh.setColumnWidth(3, 210); sh.setColumnWidths(4, 3, 130); sh.setColumnWidth(7, 220);
  sh.getRange(5, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  return chk;
}

/** 매일 점검 메일 (트리거: 매일 18시) */
/** 시각 칸 → 'YYYY-MM-DD' (2026-11-18: 시트가 '2026-11-18 16:40:01' 글자를 날짜로 바꿔 저장해서 String().slice 로는 오늘 집계가 0 이 됨) */
function ymd10_(v) { return v instanceof Date || (v && typeof v.getTime === 'function') ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v || '').slice(0, 10); }

function dailyReport() {
  try { tidyPrePhotos_(); } catch (e) { logError_('사진 정리', e); }
  var chk = refreshDashboard();
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS');
  if (!to) return;
  var t = chk.tomorrow, R = rules_();
  var subject = '[이수다 매일 점검] ' + dayLabel_(chk.today) + ' ' + (chk.issues.length ? '⚠️ 확인 필요 ' + chk.issues.length + '건' : '✅ 이상 없음');
  var areas = Object.keys(t.byArea).map(function (a) { return a + ' ' + t.byArea[a]; }).join(', ');
  var next7 = [];
  for (var k = 1; k <= 7; k++) { var d = R.addDays(chk.today, k); next7.push(dayLabel_(d) + ' ' + (chk.counts[d] || 0) + '건'); }
  var body = [
    '■ 확인 필요',
    chk.issues.length ? chk.issues.map(function (s) { return '⚠️ ' + s; }).join('\n') : '없음',
    '',
    '■ 정상 확인',
    chk.ok.map(function (s) { return '✅ ' + s; }).join('\n'),
    '',
    (function () { var y = R.addDays(chk.today, -1), s = driverSummary_(y); return '■ 어제 ' + dayLabel_(y) + ' 기사님 체크: 완료 ' + s.done + '건' + (s.fail ? ', 못함 ' + s.fail + '건' : '') + ' / 장부 ' + (chk.counts[y] || 0) + '건'; })(),
    (function () { var a = alimStatus_(); return '■ 알림톡: ' + (a.on ? '켜짐' : '꺼짐') + (a.missing.length ? ' (준비 남음: ' + a.missing.join(', ') + ')' : ''); })(),
    (function () {
      var sh = ss_().getSheetByName(SHEET_CANCEL_LOG); if (!sh) return '■ 오늘 처리한 취소: 없음';
      var t = sh.getDataRange().getValues().slice(1).filter(function (r) { return ymd10_(r[0]) === chk.today; })
        .map(function (r) { return dayLabel_(fmtDate_(r[1])) + ' ' + r[2] + '번 ' + r[3]; });
      return '■ 오늘 처리한 취소: ' + (t.length ? t.length + '건 — ' + t.join(', ') : '없음');
    })(),
    (function () { try { return visitSummary_(chk.today).text; } catch (e) { return '■ 신청 화면 방문: 집계 실패'; } })(),
    '■ 오늘 들어온 신청: ' + chk.todayNew + '건 (사진 올린 신청 ' + chk.photos + '건)' + (chk.kakaoNew ? ' + 카톡 예약 연락처 등록 ' + chk.kakaoNew + '건' : ''),
    '■ 내일 ' + dayLabel_(t.date) + ' 수거: 전체 ' + t.total + '건 (신청페이지 ' + t.page + '건' + (areas ? ': ' + areas : '') + ')',
    '■ 앞으로 7일 (장부 포함): ' + next7.join(' / '),
    '',
    '자세한 표는 예약 서버 시트 "현황" 탭에서 볼 수 있어요. 연락처·계좌는 이 메일에 넣지 않아요.'
  ].join('\n');
  MailApp.sendEmail({ to: to, subject: subject, body: body });
  return { issues: chk.issues.length };
}

/**
 * 예약 취소 (2026-11-15 대표 요청: 취소가 서로 잘 보이게)
 *  - 장부 줄은 지우지 않는다 → 번호(=봉투 번호)가 그대로 유지됨
 *  - 장부 줄: 빨간 취소선 + 연한 빨간 바탕 + 메모 앞에 [취소 MM/DD HH:mm]
 *  - 예약 시트(신청페이지 예약): 확정상태 = 취소, 취소일시 기록 → 그날 자리 1개 다시 열림
 *  - '취소기록' 탭에 한 줄 (언제, 어느 날 몇 번 누구) → 현황판·점검 메일·기사님 화면에 표시
 * 입력: 예약번호(ESD-261116-AB12) 또는 "날짜 번호" (예: 11/16 3, 2026-11-16 3) — 카톡 예약도 번호로 취소
 */
var SHEET_CANCEL_LOG = '취소기록';
var CANCEL_BG = '#fde7e9', CANCEL_FG = '#c62828';

function parseCancelInput_(input) {
  var s = String(input || '').trim().toUpperCase();
  if (/^\d{4}-[A-Z0-9]{4}$/.test(s)) s = resolveRid_(s) || s;   // 2026-11-17: 짧은 번호(1118-4829)
  var m = /^ESD-\d{6}-[A-Z0-9]{4}$/.exec(s);
  if (m) return { rid: s, date: '20' + s.slice(4, 6) + '-' + s.slice(6, 8) + '-' + s.slice(8, 10) };
  var R = rules_(), today = R.todayKST(new Date());
  m = /^(?:(\d{4})[-./])?(\d{1,2})[-./](\d{1,2})\D*\s+(\d{1,3})\s*번?$/.exec(s);
  if (!m) return null;
  var y = m[1] || today.slice(0, 4), mo = ('0' + m[2]).slice(-2), d = ('0' + m[3]).slice(-2);
  var date = y + '-' + mo + '-' + d;
  if (!m[1] && date < R.addDays(today, -31)) date = (+y + 1) + '-' + mo + '-' + d; // 연말에 1월 날짜를 넣은 경우
  return R.parseYmd(date) ? { date: date, no: +m[4] } : null;
}

/** 장부에서 날짜+번호 또는 예약번호로 줄 찾기 */
function ledgerFindEntry_(q) {
  var lss = ledgerOpen_(q.date);
  if (!lss) return null;
  var sh = ledgerMonthSheet_(lss, q.date);
  if (!sh) return null;
  var tz = lss.getSpreadsheetTimeZone() || 'GMT', v = sh.getDataRange().getValues(), LC = ledgerCols_(sh, v);
  for (var i = 1; i < v.length; i++) {
    var memo = String(v[i][LC.memo - 1] || '');
    if (q.rid ? memo.indexOf(q.rid) >= 0 : (cellYmd_(v[i][LEDGER_COL.date - 1], tz) === q.date && String(v[i][LEDGER_COL.no - 1]) === String(q.no) && String(v[i][LEDGER_COL.name - 1] || '').trim())) {
      var rid = q.rid || ((/ESD-\d{6}-[A-Z0-9]{4}/.exec(memo) || [])[0] || '');
      return { sheet: sh, row: i + 1, no: v[i][LEDGER_COL.no - 1], name: String(v[i][LEDGER_COL.name - 1] || ''), area: String(v[i][LEDGER_COL.area - 1] || ''),
        memo: memo, memoCol: LC.memo, weight: v[i][LEDGER_COL.weight - 1], rid: rid, cancelled: /^\[취소/.test(memo) };
    }
  }
  return null;
}

function cancelReservation(input) {
  var q = parseCancelInput_(input);
  if (!q) return { ok: false, msg: '예약번호(예: ESD-261116-AB12) 또는 "날짜 번호"(예: 11/16 3)로 넣어 주세요.' };
  var lock = ledgerLock_();
  if (!lock.tryLock(15000)) return { ok: false, msg: '잠시 뒤 다시 해 주세요 (다른 작업 중)' };
  try {
    var now = new Date(), stamp = Utilities.formatDate(now, 'Asia/Seoul', 'MM/dd HH:mm');
    var msgs = [], f = ledgerFindEntry_(q), rid = q.rid || (f && f.rid) || '';
    if (f) {
      if (f.cancelled) msgs.push('장부: 이미 취소 표시돼 있어요 (' + f.no + '번 ' + f.name + ')');
      else {
        f.sheet.getRange(f.row, f.memoCol).setValue('[취소 ' + stamp + '] ' + f.memo);
        // 2026-11-20: 칸 서식으로 칠하면 줄을 옮기거나 정렬할 때 빨간 줄이 엉뚱한 고객에 남음(구지은·임보람·서승아) →
        // 메모가 '[취소'로 시작하는 줄을 자동으로 칠하는 조건부 서식으로 (줄을 어디로 옮겨도 따라감)
        try { ensureCancelRule_(f.sheet, f.memoCol); } catch (e) { f.sheet.getRange(f.row, 1, 1, f.memoCol).setBackground(CANCEL_BG).setFontColor(CANCEL_FG).setFontLine('line-through'); }
        bumpLedgerCount_(q.date, -1);
        msgs.push('장부: ' + f.no + '번 ' + f.name + ' 줄에 빨간 취소선 표시 (번호는 그대로)' + (String(f.weight == null ? '' : f.weight).trim() ? ' — 무게가 이미 적혀 있으니 확인해 주세요' : ''));
      }
    } else msgs.push(q.rid ? '장부: 이 예약번호 줄이 없어요' : '장부: ' + q.date.slice(5).replace('-', '/') + ' ' + q.no + '번 줄이 없어요');
    var b = bookData_();
    if (rid) {
      var hdr = ensureBookHeaders_(b.sh, ['취소일시']), data = b.sh.getDataRange().getValues(), cId = hdr.indexOf('예약번호');
      for (var i = 1; i < data.length; i++) if (String(data[i][cId]) === rid) {
        if (String(data[i][hdr.indexOf('확정상태')]) === '취소') msgs.push('예약 시트: 이미 취소돼 있었어요');
        else {
          b.sh.getRange(i + 1, hdr.indexOf('확정상태') + 1).setValue('취소');
          b.sh.getRange(i + 1, hdr.indexOf('취소일시') + 1).setValue(Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm'));
          msgs.push('예약 시트: 취소로 바꿨어요 (그날 자리 1개 다시 열림)');
        }
        break;
      }
    }
    if (!f && !rid) return { ok: false, msg: msgs.join('\n') };
    if (f && !f.cancelled) {
      sheet_(SHEET_CANCEL_LOG, ['취소시각', '수거일', '번호', '이름', '지역구', '예약번호'])
        .appendRow([Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), q.date, f.no, f.name, f.area, rid]);
    }
    if (q.date) driverCacheClear_(q.date);   // 2026-11-17: 기사님 화면에 바로 취소로 보이게
    return { ok: true, msg: (f ? q.date.slice(5).replace('-', '/') + ' ' + f.no + '번 ' + f.name : rid) + ' 취소 처리\n' + msgs.join('\n') };
  } finally { lock.releaseLock(); }
}

/** 장부 시트에 '메모가 [취소 로 시작하면 빨간 취소선' 조건부 서식 (한 번만 추가) */
function ensureCancelRule_(sh, memoCol) {
  var L = colLetter_(memoCol), rules = sh.getConditionalFormatRules();
  var has = rules.some(function (r) { var c = r.getBooleanCondition && r.getBooleanCondition(); return c && String((c.getCriteriaValues() || [])[0] || '').indexOf('[취소') >= 0; });
  if (has) return false;
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($' + L + '2,3)="[취소"')
    .setBackground(CANCEL_BG).setFontColor(CANCEL_FG).setStrikethrough(true).setRanges([sh.getRange('A2:' + L + sh.getMaxRows())]).build());
  sh.setConditionalFormatRules(rules);
  return true;
}

/** 그날 취소 목록 [{no, name, area, at}] — 기사님 화면·현황판·메일용 */
function cancelsFor_(date) {
  var sh = ss_().getSheetByName(SHEET_CANCEL_LOG);
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).filter(function (r) { return fmtDate_(r[1]) === date; })
    .map(function (r) { return { no: r[2], name: String(r[3]), area: String(r[4]), at: (r[0] instanceof Date || (r[0] && typeof r[0].getTime === 'function')) ? Utilities.formatDate(r[0], 'Asia/Seoul', 'MM-dd HH:mm') : String(r[0]).slice(5) }; });
}

function menuCancel_() {
  var ui = SpreadsheetApp.getUi();
  var p = ui.prompt('예약 취소', '예약번호(예: 1118-4829) 또는 날짜와 장부 번호(예: 11/18 3)를 넣어 주세요.\n카톡으로 받은 예약은 날짜와 번호로 넣으면 돼요. 번호를 모르면 메뉴 「예약 찾기」.', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var input = p.getResponseText().trim(), q = parseCancelInput_(input);
  if (!q) { ui.alert('예약번호 또는 "11/16 3" 처럼 넣어 주세요.'); return; }
  var f = ledgerFindEntry_(q);
  var who = f ? (q.date.slice(5).replace('-', '/') + ' ' + f.no + '번 ' + f.name + ' (' + f.area + ')') : input;
  if (ui.alert('예약 취소', who + ' 을(를) 취소할까요?\n장부 줄은 남기고 빨간 취소선으로 표시해요 (번호 그대로).', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var r = cancelReservation(input);
  ui.alert(r.msg);
  try { refreshDashboard(); } catch (e) {}
}
function menuDashboard_() { refreshLedgerCounts_(); refreshDashboard(); }
function menuReportNow_() { dailyReport(); SpreadsheetApp.getUi().alert('점검 메일을 보냈어요.'); }

/** 마감·주말예외 탭 모양 (머리글 고정·설명·날짜 칸·구역 드롭다운) */
function formatScheduleSheets_() {
  var cl = sheet_(SHEET_CLOSE, ['시작일', '종료일', '구역', '안내문구', '메모']);
  cl.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#fff3e0');
  cl.setFrozenRows(1);
  cl.setColumnWidth(1, 110); cl.setColumnWidth(2, 110); cl.setColumnWidth(3, 130); cl.setColumnWidth(4, 320); cl.setColumnWidth(5, 200);
  cl.getRange(1, 1).setNote('닫을 첫날 (예: 2027-02-16). 이 탭에 적은 날은 신청 화면에서 바로 닫혀요.');
  cl.getRange(1, 2).setNote('닫을 마지막 날. 하루만 닫으면 비워 두세요.');
  cl.getRange(1, 3).setNote('전체 / 남쪽(홀수일) / 북쪽(짝수일) 중 고르기. 비우면 전체.');
  cl.getRange(1, 4).setNote('고객 화면에 보일 안내 (예: 설 연휴 휴무). 비워도 돼요.');
  var dv = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('날짜를 넣어 주세요 (예: 2027-02-16)').build();
  cl.getRange(2, 1, 200, 2).setDataValidation(dv).setNumberFormat('yyyy-mm-dd');
  cl.getRange(2, 3, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['전체', '남쪽(홀수일)', '북쪽(짝수일)'], true).setAllowInvalid(true).build());
  var op = sheet_(SHEET_OPEN, ['날짜', '메모']);
  op.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#e3f2fd');
  op.setFrozenRows(1); op.setColumnWidth(1, 110); op.setColumnWidth(2, 300);
  op.getRange(1, 1).setNote('주말인데 수거하는 날 (예: 2026-12-19). 적으면 그 토·일에도 신청을 받아요.');
  op.getRange(2, 1, 200, 1).setDataValidation(dv).setNumberFormat('yyyy-mm-dd');
}

/** 장부 날짜 칸 모양 맞추기 — 날짜 칸이 기본 모양(2026-11-16)인 줄을 그 시트에서 많이 쓰는 모양(11/16(월))으로 */
function tidyLedgerDateFormats_() {
  var R = rules_(), today = R.todayKST(new Date()), done = 0, seen = {};
  [0, 31, 62].forEach(function (k) {
    var d = R.addDays(today, k), lss = ledgerOpen_(d);
    if (!lss) return;
    var sh = ledgerMonthSheet_(lss, d); if (!sh || seen[sh.getName()]) return; seen[sh.getName()] = 1;
    var tz = lss.getSpreadsheetTimeZone() || 'GMT', v = sh.getDataRange().getValues(), fmt = ledgerDateFormat_(sh, v, tz);
    if (!fmt) return;
    var f = sh.getRange(1, LEDGER_COL.date, v.length, 1).getNumberFormats();
    for (var i = 1; i < v.length; i++) {
      if (!cellYmd_(v[i][LEDGER_COL.date - 1], tz)) continue;
      if (/^(General|yyyy-mm-dd|yyyy-MM-dd|)$/i.test(String(f[i][0] || ''))) { sh.getRange(i + 1, LEDGER_COL.date).setNumberFormat(fmt); done++; }
    }
  });
  return done;
}

/** 2026-11-15 운영 도우미 설치 (한 번 실행) */
function setupHelpers() {
  var ss = ss_(), p = PropertiesService.getScriptProperties();
  ss.setSpreadsheetTimeZone('Asia/Seoul');
  if (!p.getProperty('LEDGER_YEAR')) p.setProperty('LEDGER_YEAR', '2026');
  formatScheduleSheets_();
  ensureBookHeaders_(sheet_(SHEET_BOOK, BOOK_HEADERS), ['취소일시']);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction(); if (h === 'syncLedgerPending' || h === 'dailyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncLedgerPending').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('dailyReport').timeBased().atHour(18).everyDays(1).inTimezone('Asia/Seoul').create();
  var fixed = tidyLedgerDateFormats_();
  try { renumberUpcoming(); } catch (e) {}
  refreshLedgerCounts_();
  var chk = refreshDashboard();
  ss.setActiveSheet(ss.getSheetByName(SHEET_DASH)); ss.moveActiveSheet(1);
  Logger.log('도우미 설치 완료 / 장부 날짜 모양 맞춤 ' + fixed + '칸 / 점검 확인필요 ' + chk.issues.length + '건: ' + chk.issues.join(' | '));
}

function menuRenumber_() { var n = renumberUpcoming(); SpreadsheetApp.getUi().alert(n + '개 날짜의 번호를 1, 2, 3 … 으로 다시 매겼어요.'); }

/** 2026-11-16 신청 응답 빠르게: 장부 입력은 5분마다 자동 반영이 처리 (한 번 실행) */
function setupFastSubmit() {
  PropertiesService.getScriptProperties().setProperty('DEFER_LEDGER', '1');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncLedgerPending') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncLedgerPending').timeBased().everyMinutes(5).create();
  Logger.log('신청 응답 빠르게 설정 완료 — 장부는 5분마다 자동 반영');
}

/* ===== 방문 단계 기록 (2026-11-16: 신청 화면에서 어디서 그만두는지) — 개인정보 없음 ===== */
var SHEET_VISIT = '방문기록';
var VISIT_STEPS = ['open', 'addr', 'date', 'submit', 'done'];
var VISIT_LABEL = { open: '화면 열기', addr: '주소 선택', date: '날짜 선택', submit: '신청 누름', done: '예약 완료', invalid: '입력 오류', leave: '나감', fail: '저장 실패', nodate: '고를 날짜 없음', photo_fail: '사진 실패', photo_read_fail: '사진 못 읽음' };
function track_(b) {
  var step = String(b.step || '');
  if (!/^[a-z_]{2,20}$/.test(step)) return { ok: false };
  try {
    sheet_(SHEET_VISIT, ['시각', '방문', '단계', '내용', '기기']).appendRow([
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
      String(b.sid || '').replace(/[^a-z0-9]/g, '').slice(0, 12), step, String(b.info || '').slice(0, 80), String(b.dev || '').slice(0, 10)]);
  } catch (e) {}
  return { ok: true };
}
/** 그날 방문 단계 요약 */
function visitSummary_(date) {
  var sh = ss_().getSheetByName(SHEET_VISIT);
  var out = { visits: 0, steps: {}, errors: {}, leaves: {}, out: {}, dev: {}, times: {}, text: '■ 신청 화면 방문: 기록 없음' };
  if (!sh) return out;
  var seen = {};
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (ymd10_(r[0]) !== date) return;
    var sid = String(r[1]), st = String(r[2]), info = String(r[3]);
    seen[sid + '|' + st] = 1;
    if (st === 'open') { out.visits++; out.dev[r[4]] = (out.dev[r[4]] || 0) + 1; }
    if (st === 'invalid') info.replace(/^server:/, '').split(',').forEach(function (f) { if (f) out.errors[f] = (out.errors[f] || 0) + 1; });
    if (st === 'leave') out.leaves[info] = (out.leaves[info] || 0) + 1;
    if (st === 't_confirm' || st === 't_photo') { var tm = /([\d.]+)초/.exec(info), nm = /^(사진\d+장|\d+\/\d+장)/.exec(info); if (tm) { var key = (st === 't_confirm' ? '확정 ' : '사진 올리기 ') + (nm ? nm[1] : ''); (out.times[key] = out.times[key] || []).push(+tm[1]); } }
    if (st === 'addr' && info && info !== 'ok') out.out[info] = (out.out[info] || 0) + 1;
  });
  Object.keys(seen).forEach(function (k) { var st = k.split('|')[1]; out.steps[st] = (out.steps[st] || 0) + 1; });
  var F = { name: '이름', phone: '휴대폰', address: '주소', addressDetail: '상세주소', date: '날짜', amount: '수거양', amountDetail: '수거양 내용', place: '놓을 곳', placeDetail: '놓을 곳 내용', entrance: '공동현관', bank: '은행', account: '계좌번호', holder: '예금주', agreeNotice: '확인 체크', agreePrivacy: '개인정보 동의', submissionId: '새로고침 필요' };
  var fun = VISIT_STEPS.map(function (s) { return VISIT_LABEL[s] + ' ' + (out.steps[s] || 0); }).join(' → ');
  var errs = Object.keys(out.errors).sort(function (a, b) { return out.errors[b] - out.errors[a]; }).map(function (k) { return (F[k] || k) + ' ' + out.errors[k]; }).join(', ');
  var lv = Object.keys(out.leaves).map(function (k) { return (VISIT_LABEL[k] || k) + ' 뒤 ' + out.leaves[k]; }).join(', ');
  var ar = Object.keys(out.out).map(function (k) { return k.replace(/^(outside|check) /, '') + ' ' + out.out[k]; }).join(', ');
  var ph = (out.steps.photo_fail || 0) + (out.steps.photo_read_fail || 0);
  out.text = '■ 신청 화면 (오늘, 사람 수): ' + fun +
    (errs ? '\n   - 많이 틀린 칸: ' + errs : '') + (lv ? '\n   - 중간에 나간 곳: ' + lv : '') + (ar ? '\n   - 받지 않는 지역 주소: ' + ar : '') +
    (out.steps.nodate ? '\n   - 고를 날짜가 없던 사람: ' + out.steps.nodate : '') + (ph ? '\n   - 사진 문제: ' + ph + '명' : '') +
    (Object.keys(out.times).length ? '\n   - 걸린 시간(평균, 최대): ' + Object.keys(out.times).sort().map(function (k) { var a = out.times[k], avg = a.reduce(function (x, y) { return x + y; }, 0) / a.length; return k + ' ' + avg.toFixed(1) + '초·' + Math.max.apply(null, a).toFixed(1) + '초(' + a.length + '건)'; }).join(', ') : '');
  return out;
}
