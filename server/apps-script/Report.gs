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
  var cId = b.col('예약번호'), cDate = b.col('수거일'), cSt = b.col('확정상태'), cSync = b.col('장부반영'), cZone = b.col('구역'), cAt = b.col('신청시각'), cPh = b.col('사진');
  var bad = { parity: [], weekend: [], closed: [], lost: [], cancelLeft: [] }, todayNew = 0, photos = 0, upcoming = 0;
  for (var i = 1; i < b.data.length; i++) {
    var r = b.data[i], rid = String(r[cId]), d = fmtDate_(r[cDate]), st = String(r[cSt]);
    if (String(r[cAt] || '').slice(0, 10) === today) { todayNew++; if (String(r[cPh] || '')) photos++; }
    if (!d || d < today) continue;
    if (st === '취소') {
      try { if (ledgerHasRid_(d, rid)) bad.cancelLeft.push(rid); } catch (e) {}
      continue;
    }
    if (st !== '확정') continue;
    upcoming++;
    var day = +d.slice(8, 10), z = String(r[cZone]);
    if ((z === 'south' && day % 2 === 0) || (z === 'north' && day % 2 === 1)) bad.parity.push(rid + ' (' + dayLabel_(d) + ')');
    var wd = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, day)).getUTCDay();
    if (R.CONFIG.closedWeekdays.indexOf(wd) >= 0 && sc.openDates.indexOf(d) < 0) bad.weekend.push(rid + ' (' + dayLabel_(d) + ')');
    var cl = R.closureFor(d, z, sc.closures);
    if (cl) bad.closed.push(rid + ' (' + dayLabel_(d) + (cl.message ? ' · ' + cl.message : '') + ')');
    if (String(r[cSync]) !== '완료') {
      var why = !ledgerIdFor_(d) ? d.slice(0, 4) + '년 장부가 아직 연결 안 됨'
        : '장부에 ' + (+d.slice(5, 7)) + '월 시트가 없거나 잠시 못 열었음 (10분마다 다시 시도)';
      try { var l = ledgerOpen_(d); if (l && ledgerMonthSheet_(l, d)) why = '다음 10분 자동 반영 때 들어갈 예정'; } catch (e) {}
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
  if (bad.cancelLeft.length) issues.push('취소했는데 장부에 줄이 남은 예약: ' + bad.cancelLeft.join(', '));
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
      if (!seen['y' + y]) { seen['y' + y] = 1; issues.push(y + '년 예약도 받기 시작했어요(달력 60일). ' + y + '년 장부를 만들면 연결해야 해요 — 그때까지 ' + y + '년 예약은 장부 대신 예약 시트에만 있고, 이 메일로 계속 알려 드려요.'); }
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
  return { issues: issues, ok: ok, pending: pending, today: today, todayNew: todayNew, photos: photos, counts: counts,
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
  sh.getRange(y, 1).setValue('점검 내용').setFontWeight('bold');
  var lines = chk.issues.map(function (s) { return ['⚠️ ' + s]; }).concat(chk.ok.map(function (s) { return ['✅ ' + s]; }));
  if (lines.length) sh.getRange(y + 1, 1, lines.length, 1).setValues(lines);
  y += lines.length + 2;
  sh.getRange(y, 1).setValue('사용법').setFontWeight('bold');
  sh.getRange(y + 1, 1, 4, 1).setValues([
    ['· 어떤 날을 닫으려면: "마감" 탭에 시작일·종료일·구역을 적으면 신청 화면에서 바로 닫혀요.'],
    ['· 주말에 받으려면: "주말예외" 탭에 날짜를 적어요.'],
    ['· 고객이 취소하면: 위 메뉴 이수다 → 예약 취소 → 예약번호 입력 (장부 줄까지 같이 정리).'],
    ['· "전체 예약"은 장부 줄 수(카톡·직원 입력 포함)라서 22건이 차면 신청 화면에서 그날이 자동으로 닫혀요.']
  ]);
  sh.setFrozenRows(4);
  sh.setColumnWidth(1, 100); sh.setColumnWidth(2, 50); sh.setColumnWidth(3, 210); sh.setColumnWidths(4, 3, 130); sh.setColumnWidth(7, 220);
  sh.getRange(5, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  return chk;
}

/** 매일 점검 메일 (트리거: 매일 18시) */
function dailyReport() {
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
    '■ 오늘 들어온 신청: ' + chk.todayNew + '건 (사진 올린 신청 ' + chk.photos + '건)',
    '■ 내일 ' + dayLabel_(t.date) + ' 수거: 전체 ' + t.total + '건 (신청페이지 ' + t.page + '건' + (areas ? ': ' + areas : '') + ')',
    '■ 앞으로 7일 (장부 포함): ' + next7.join(' / '),
    '',
    '자세한 표는 예약 서버 시트 "현황" 탭에서 볼 수 있어요. 연락처·계좌는 이 메일에 넣지 않아요.'
  ].join('\n');
  MailApp.sendEmail({ to: to, subject: subject, body: body });
  return { issues: chk.issues.length };
}

/** 예약 취소 — 예약 시트 '확정상태'=취소, 장부 줄 삭제(무게가 적혀 있으면 지우지 않고 메모에 [취소]) */
function cancelReservation(rid) {
  rid = String(rid || '').trim().toUpperCase();
  if (!/^ESD-\d{6}-[A-Z0-9]{4}$/.test(rid)) return { ok: false, msg: '예약번호 모양이 아니에요 (예: ESD-261116-AB12)' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, msg: '잠시 뒤 다시 해 주세요 (다른 작업 중)' };
  try {
    var b = bookData_(), hdr = ensureBookHeaders_(b.sh, ['취소일시']);
    var data = b.sh.getDataRange().getValues(), cId = hdr.indexOf('예약번호'), row = -1;
    for (var i = 1; i < data.length; i++) if (String(data[i][cId]) === rid) { row = i; break; }
    var date = row >= 0 ? fmtDate_(data[row][hdr.indexOf('수거일')]) : '20' + rid.slice(4, 6) + '-' + rid.slice(6, 8) + '-' + rid.slice(8, 10);
    var msgs = [];
    if (row >= 0) {
      if (String(data[row][hdr.indexOf('확정상태')]) === '취소') msgs.push('예약 시트: 이미 취소돼 있었어요');
      else {
        b.sh.getRange(row + 1, hdr.indexOf('확정상태') + 1).setValue('취소');
        b.sh.getRange(row + 1, hdr.indexOf('취소일시') + 1).setValue(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'));
        msgs.push('예약 시트: 취소로 바꿨어요 (그날 자리 1개 다시 열림)');
      }
    } else msgs.push('예약 시트: 이 예약번호가 없어요 (카톡 예약이면 장부만 정리)');
    var f = ledgerFind_(date, rid);
    if (!f) msgs.push('장부: 이 예약번호 줄이 없어요');
    else if (String(f.weight == null ? '' : f.weight).trim()) {
      var mc = f.sheet.getRange(f.row, LEDGER_COL.memo);
      var mv = String(mc.getValue() || ''); if (mv.indexOf('[취소]') < 0) mc.setValue('[취소] ' + mv);
      msgs.push('장부: 무게가 이미 적혀 있어서 줄은 남기고 메모에 [취소]만 붙였어요 (' + f.row + '행)');
    } else {
      var v = f.values, k = f.row - 1;
      var blank = function (r) { if (r < 1 || r >= v.length) return r >= v.length; for (var c = 0; c < 5; c++) if (String(v[r][c] == null ? '' : v[r][c]).trim()) return false; return true; };
      f.sheet.deleteRow(f.row);
      var extra = 0;
      if (blank(k + 1) && blank(k - 1)) { // 그 날짜에 이 예약 하나뿐이었으면 위쪽 빈 줄(2칸)도 정리
        for (var g = 1; g <= LEDGER_GAP && k - g >= 1 && blank(k - g); g++) { f.sheet.deleteRow(f.row - g); extra++; }
      }
      bumpLedgerCount_(date, -1);
      msgs.push('장부: ' + f.row + '행을 지웠어요' + (extra ? ' (그날 다른 예약이 없어 빈 줄 ' + extra + '칸도 정리)' : ''));
    }
    return { ok: true, msg: rid + ' 취소 처리\n' + msgs.join('\n') };
  } finally { lock.releaseLock(); }
}

function menuCancel_() {
  var ui = SpreadsheetApp.getUi();
  var p = ui.prompt('예약 취소', '취소할 예약번호를 넣어 주세요 (예: ESD-261116-AB12)', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var rid = p.getResponseText().trim();
  if (ui.alert('예약 취소', rid + ' 를 취소할까요?\n예약 시트는 "취소"로 바뀌고, 장부 줄은 지워져요(무게가 적힌 줄은 남겨 둠).', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var r = cancelReservation(rid);
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
  refreshLedgerCounts_();
  var chk = refreshDashboard();
  ss.setActiveSheet(ss.getSheetByName(SHEET_DASH)); ss.moveActiveSheet(1);
  Logger.log('도우미 설치 완료 / 장부 날짜 모양 맞춤 ' + fixed + '칸 / 점검 확인필요 ' + chk.issues.length + '건: ' + chk.issues.join(' | '));
}
