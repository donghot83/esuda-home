/**
 * 신한은행 다건이체 파일 만들기 — 범위: 파일 생성까지. 은행 업로드·승인·송금은 권한 있는 담당자가 직접 한다.
 *
 * 대상: 예약 시트에서 확정된 예약 중
 *   - 장부(N월 매입금액)에 같은 예약번호 줄이 있고 무게(F열)가 적혀 있으며
 *   - 지급액이 0보다 크고(15kg 이상) — 장부 금액(I열)이 숫자면 그 값, 비어 있으면 (무게-로스)×단가로 계산
 *   - 아직 이체 파일에 들어가지 않은 것
 * 15kg 미만(무상수거)은 파일에 넣지 않고 예약 시트에 '무상수거'로 표시한다.
 *
 * 결과: 대표 드라이브에 새 스프레드시트 '[신한 다건이체] 날짜' (업로드용 / 확인용 두 시트). 공유하지 않는다.
 * 은행 업로드 열 순서는 TRANSFER_COLUMNS 로 바꾼다(신한 샘플 양식에 맞춰 조정).
 * 카카오채널로 받은 예약(계좌가 채팅에만 있는 것)은 대상이 아니다.
 */

var BANK_CODES = {
  '신한은행': '088', 'KB국민은행': '004', '우리은행': '020', '하나은행': '081', 'NH농협은행': '011', 'IBK기업은행': '003',
  '카카오뱅크': '090', '토스뱅크': '092', '새마을금고': '045', '우체국': '071', 'SC제일은행': '023', '부산은행': '032',
  '대구은행': '031', '경남은행': '039', '광주은행': '034', '전북은행': '037', '수협은행': '007', '신협': '048',
  '케이뱅크': '089', '씨티은행': '027', '산림조합': '064', '저축은행': '050',
  // 증권사 (금융결제원 기관코드 — 첫 이체 때 은행 화면에서 기관명이 맞는지 한 번 확인)
  '키움증권': '264', '미래에셋증권': '238', '삼성증권': '240', 'NH투자증권': '247', '한국투자증권': '243', 'KB증권': '218',
  '신한투자증권': '278', '토스증권': '271', '카카오페이증권': '288', '대신증권': '267', '하나증권': '270', '메리츠증권': '287'
};

// 업로드용 시트 열 순서 = 신한 BizBank '자금이체 등록 > 파일불러오기' 지정 필드 순서
// (신한은행 '기업인터넷뱅킹 대량이체(급여이체)' 안내서: 입금은행, 입금계좌, 고객관리성명, 입금액, 출금통장표시, 입금통장표시)
// 입금은행은 반드시 은행코드 3자리, 입금통장표시는 최대 7자. 첫 행(항목명)은 불러올 때 '첫 행 제외' 체크.
var TRANSFER_COLUMNS = ['입금은행', '입금계좌', '고객관리성명', '입금액', '출금통장표시', '입금통장표시'];
var TRANSFER_SENDER_MEMO = '이수다매입';   // 입금통장표시: 고객 통장에 찍힐 글자 (최대 7자)
var TRANSFER_EXTRA_HEADERS = ['이체파일', '지급상태', '입금완료일'];  // 예약 시트 끝에 덧붙이는 열

function transferUnitPrice_() {
  var v = PropertiesService.getScriptProperties().getProperty('TRANSFER_UNIT_PRICE');
  return v ? +v : 250;
}

/** 예약 시트 머리글에 추가 열이 없으면 끝에 붙인다. 반환: 머리글 배열 */
function ensureTransferHeaders_(sh) {
  var data = sh.getDataRange().getValues(), hdr = data[0];
  TRANSFER_EXTRA_HEADERS.forEach(function (h) {
    if (hdr.indexOf(h) < 0) { sh.getRange(1, hdr.length + 1).setValue(h); hdr.push(h); }
  });
  return hdr;
}

/** 장부에서 예약번호 줄 찾기 → {weight, loss, amount(장부 I열), row} | null */
function ledgerRowFor_(lss, dateStr, rid) {
  lss = ledgerOpen_(dateStr);           // 연도별 장부 (2027년 예약은 27년 장부에서 찾음)
  if (!lss) return null;
  var sh = ledgerMonthSheet_(lss, dateStr);
  if (!sh) return null;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][LEDGER_COL.memo - 1] || '').indexOf(rid) >= 0) {
      return { weight: v[i][5], loss: v[i][6], amount: v[i][8], row: i + 1 };
    }
  }
  return null;
}

/** 지급액 계산: 장부 금액이 숫자면 그대로('무상수거' 글자면 0), 아니면 장부와 같은 식 — 최종(무게-로스) ≥ 15kg 일 때 최종×단가 - 로스×로스단가 */
function payAmount_(lr, unit) {
  var w = +lr.weight;
  if (!(w > 0)) return { ok: false, reason: '무게 없음' };
  if (typeof lr.amount === 'number' && isFinite(lr.amount)) return { ok: true, amount: Math.round(lr.amount), source: '장부' };
  if (String(lr.amount || '').indexOf('무상') >= 0) return { ok: true, amount: 0, source: '장부' };
  var loss = +lr.loss || 0, net = w - loss;
  if (net < 15) return { ok: true, amount: 0, source: '계산' };
  return { ok: true, amount: Math.round(net * unit - loss * lossUnitPrice_()), source: '계산' };
}

function digitsOnly_(s) { return String(s || '').replace(/[^0-9]/g, ''); }

/**
 * 다건이체 파일 만들기. 반환 {count, total, free, skipped:[{예약번호, 이유}], url}
 * opts.dryRun = true 면 파일·표시 없이 목록만 계산(시험용)
 */
function makeTransferFile(opts) {
  opts = opts || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { error: 'busy' };
  try {
    var sh = sheet_(SHEET_BOOK, BOOK_HEADERS);
    var hdr = ensureTransferHeaders_(sh);
    var data = sh.getDataRange().getValues();
    var col = function (h) { return hdr.indexOf(h); };
    var lid = PropertiesService.getScriptProperties().getProperty('LEDGER_ID');
    if (!lid) return { error: 'no_ledger' };
    var lss = null, unit = transferUnitPrice_();
    var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
    var rows = [], check = [], marks = [], skipped = [], free = 0, total = 0;
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (String(r[col('확정상태')]) !== '확정') continue;
      if (String(r[col('이체파일')] || '') || String(r[col('지급상태')] || '')) continue; // 이미 처리
      var rid = String(r[col('예약번호')]), date = fmtDate_(r[col('수거일')]);
      var lr = ledgerRowFor_(lss, date, rid);
      var notYet = date >= Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); // 오늘 밤 수거 포함 아직 전 → '확인 필요'로 띄우지 않음
      if (!lr) { if (!notYet) skipped.push({ 예약번호: rid, 이유: '장부에 줄 없음' }); continue; }
      var pa = payAmount_(lr, unit);
      if (!pa.ok) { if (!notYet) skipped.push({ 예약번호: rid, 이유: pa.reason }); continue; }
      if (pa.amount <= 0) { free++; marks.push({ row: i + 1, file: '', state: '무상수거', rid: rid, lr: lr }); continue; }
      var bank = String(r[col('은행')]), code = BANK_CODES[bank];
      var acct = digitsOnly_(r[col('계좌번호')]);
      if (col('무상희망') >= 0 && String(r[col('무상희망')]) === '예') { free++; marks.push({ row: i + 1, file: '', state: '무상수거(고객 희망)', rid: rid, lr: lr }); continue; }
      if (!acct) { skipped.push({ 예약번호: rid, 이유: '계좌 없음 — 고객에게 계좌를 받아 예약 시트에 넣어 주세요' }); continue; }
      if (!code || acct.length < 6) { skipped.push({ 예약번호: rid, 이유: '은행·계좌 확인 필요' }); continue; }
      var holder = String(r[col('예금주')] || r[col('이름')]);
      var rec = { '은행코드': code, '은행명': bank, '계좌번호': acct, '금액': pa.amount, '예금주': holder,
        '입금은행': code, '입금계좌': acct, '고객관리성명': holder, '입금액': pa.amount,
        '출금통장표시': holder.slice(0, 7), '입금통장표시': TRANSFER_SENDER_MEMO.slice(0, 7), '예약번호': rid, '수거일': date,
        '무게': lr.weight, '로스': lr.loss || '', '금액근거': pa.source, '장부행': lr.row };
      rows.push(TRANSFER_COLUMNS.map(function (h) { return rec[h]; }));
      check.push(rec); total += pa.amount;
      marks.push({ row: i + 1, state: '이체파일생성', rid: rid, lr: lr, amount: pa.amount });
    }
    var res = { count: rows.length, total: total, free: free, skipped: skipped, url: '' };
    if (opts.dryRun || (!rows.length && !free)) { res.preview = check; return res; }
    var fileName = '';
    if (rows.length) {
      fileName = '[신한 다건이체] ' + now;
      var out = SpreadsheetApp.create(fileName);
      var up = out.getSheets()[0]; up.setName('업로드용');
      up.getRange(1, 1, 1, TRANSFER_COLUMNS.length).setValues([TRANSFER_COLUMNS]);
      up.getRange(2, 1, rows.length, TRANSFER_COLUMNS.length).setNumberFormat('@').setValues(rows.map(function (x) { return x.map(String); }));
      var ck = out.insertSheet('확인용');
      var ch = ['예약번호', '수거일', '예금주', '은행명', '은행코드', '계좌번호', '무게', '로스', '금액', '금액근거', '장부행'];
      ck.getRange(1, 1, 1, ch.length).setValues([ch]);
      ck.getRange(2, 1, check.length, ch.length).setValues(check.map(function (c) { return ch.map(function (h) { return h === '계좌번호' || h === '은행코드' ? "'" + c[h] : c[h]; }); }));
      ck.getRange(check.length + 3, 1, 1, 3).setValues([['합계', check.length + '건', total]]);
      res.url = out.getUrl();
    }
    marks.forEach(function (m) {
      sh.getRange(m.row, col('지급상태') + 1).setValue(m.state);
      if (m.state === '이체파일생성') sh.getRange(m.row, col('이체파일') + 1).setValue(fileName);
      if (/^무상수거/.test(m.state)) { try { alimSettled_(m.rid, m.lr, 0); } catch (e) { logError_('알림톡(무상수거)', e); } }
      // 2026-11-16 대표 결정: 입금 '예정' 안내를 이체 파일 만들 때 먼저 보내고, 송금은 그 뒤에
      if (m.state === '이체파일생성' && m.amount > 0) { try { alimSettled_(m.rid, m.lr, m.amount); } catch (e) { logError_('알림톡(입금 예정)', e); } }
    });
    return res;
  } finally { lock.releaseLock(); }
}

/**
 * 은행에서 실제 송금을 마친 뒤 실행: 해당 이체 파일의 예약을 '입금완료'로 표시.
 * (입금 예정 알림톡은 이체 파일 만들 때 이미 보냄 — 여기서는 표시만)
 */
function markTransferPaid(fileName) {
  var sh = sheet_(SHEET_BOOK, BOOK_HEADERS);
  var hdr = ensureTransferHeaders_(sh), data = sh.getDataRange().getValues();
  var cF = hdr.indexOf('이체파일'), cS = hdr.indexOf('지급상태'), cD = hdr.indexOf('입금완료일');
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'), n = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][cF]) === String(fileName) && String(data[i][cS]) === '이체파일생성') {
      sh.getRange(i + 1, cS + 1).setValue('입금완료'); sh.getRange(i + 1, cD + 1).setValue(today); n++;
    }
  }
  return { updated: n };
}

/** 스프레드시트 메뉴: 직원이 버튼으로 실행 */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('이수다')
      .addItem('예약 찾기 (이름·연락처 뒤4자리·번호)', 'menuFindBooking_')
      .addItem('예약 취소 (예약번호 또는 날짜 번호)', 'menuCancel_')
      .addItem('동선 짜기 (번호 확정)', 'menuRoute_')
      .addItem('현황판 새로 고침', 'menuDashboard_')
      .addItem('점검 메일 지금 보내기', 'menuReportNow_')
      .addItem('기사님 코드 보기·바꾸기', 'menuDriverKey_')
      .addItem('장부 번호 다시 매기기 (오늘 이후)', 'menuRenumber_')
      .addSeparator()
      .addItem('신한 다건이체 파일 만들기', 'menuMakeTransfer_')
      .addItem('이체 파일 입금완료 처리', 'menuMarkPaid_')
      .addItem('장부 금액 수식 채우기 (신청페이지 줄)', 'menuFillCalc_')
      .addToUi();
  } catch (e) {}
}
function menuMakeTransfer_() {
  var ui = SpreadsheetApp.getUi(), r = makeTransferFile();
  if (r.error) { ui.alert('실행하지 못했어요: ' + r.error); return; }
  var msg = '이체 대상 ' + r.count + '건, 합계 ' + r.total.toLocaleString() + '원\n무상수거 ' + r.free + '건';
  if (r.skipped.length) msg += '\n\n확인 필요 ' + r.skipped.length + '건:\n' + r.skipped.map(function (s) { return s.예약번호 + ' - ' + s.이유; }).join('\n');
  if (r.url) {
    msg += '\n\n파일: ' + r.url + '\n\n엑셀 바로 받기: ' + r.url.replace(/\/edit.*$/, '') + '/export?format=xlsx' +
      '\n→ 신한 BizBank 대량이체 > 파일불러오기 (첫 행 제외) > 수취인일괄조회 > 다음·승인' +
      '\n→ 송금 끝나면 메뉴 「이체 파일 입금완료 처리」';
  }
  ui.alert(msg);
}
function menuFillCalc_() {
  SpreadsheetApp.getUi().alert('신청페이지 줄 ' + fillLedgerCalc() + '곳에 금액 수식을 넣었어요.');
}
/** 아직 입금완료 처리 안 한 이체 파일 이름들 (최근 것 먼저) */
function pendingTransferFiles_() {
  var sh = sheet_(SHEET_BOOK, BOOK_HEADERS), hdr = ensureTransferHeaders_(sh), data = sh.getDataRange().getValues();
  var cF = hdr.indexOf('이체파일'), cS = hdr.indexOf('지급상태'), seen = {}, out = [];
  for (var i = 1; i < data.length; i++) {
    var f = String(data[i][cF] || '');
    if (f && String(data[i][cS]) === '이체파일생성' && !seen[f]) { seen[f] = 1; out.push(f); }
  }
  return out.sort().reverse();
}
function menuMarkPaid_() {
  var ui = SpreadsheetApp.getUi();
  var files = pendingTransferFiles_();
  if (!files.length) { ui.alert('입금완료 처리할 이체 파일이 없어요.'); return; }
  var p = ui.prompt('송금을 마친 이체 파일',
    '아직 입금완료 안 한 파일:\n' + files.join('\n') + '\n\n비워 두고 확인을 누르면 가장 최근 파일(' + files[0] + ')을 처리해요.', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var name = p.getResponseText().trim() || files[0];
  var r = markTransferPaid(name);
  ui.alert(name + '\n' + r.updated + '건을 입금완료로 표시했어요.');
}
