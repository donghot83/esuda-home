/**
 * 기사님 화면 (2026-11-15) — esuda.kr/driver/ 에서 휴대폰으로 그날 수거 목록 보기 + 수거 완료 체크
 *
 * 목록 = 장부(N월 매입금액)에서 그날 줄 전부 (카톡·직원 입력 포함, 장부 순서 그대로)
 *   + 신청페이지 예약이면 예약 시트에서 연락처·놓을 곳·공동현관(비번)·수거양·요청사항을 붙인다.
 * 계좌번호는 기사님 화면에 절대 보내지 않는다.
 *
 * 보안: 스크립트 속성 DRIVER_KEY(기사님 코드). 코드는 주소창이 아니라 요청 본문으로만 받는다.
 *       코드를 바꾸면(메뉴 '기사님 코드 새로 만들기') 예전 휴대폰은 다시 코드를 넣어야 한다.
 * 완료 기록: 예약 서버 시트 '기사기록' 탭 (수거일 | ID | 이름 | 상태 | 시각) — 마지막 기록이 현재 상태.
 */

var SHEET_DRIVER = '기사기록';
var DRIVER_LOG_HEADERS = ['수거일', 'ID', '이름', '상태', '시각'];

function checkDriverKey_(key) {
  var k = PropertiesService.getScriptProperties().getProperty('DRIVER_KEY');
  return !!k && String(key || '').trim().toUpperCase() === k;
}

function newDriverKey_() {
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 10; i++) s += a.charAt(Math.floor(Math.random() * a.length));
  PropertiesService.getScriptProperties().setProperty('DRIVER_KEY', s);
  return s;
}

/** 기사님 기본 날짜: 새벽 6시 전이면 전날 목록(저녁 7시~새벽 4시 수거라서) */
function driverDefaultDate_(now) {
  var R = rules_(), t = R.todayKST(now);
  return R.hourKST(now) < 6 ? R.addDays(t, -1) : t;
}

/** 장부 한 줄 → 지도 검색용 주소 */
function driverMapQuery_(area, addr) {
  area = String(area || '').trim(); addr = String(addr || '').trim();
  var head = /시$/.test(area) ? '경기 ' + area : '서울 ' + area;
  return (head + ' ' + addr).replace(/\s+/g, ' ').trim();
}

function driverStatus_(date) {
  var out = {};
  var sh = ss_().getSheetByName(SHEET_DRIVER);
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (fmtDate_(r[0]) === date) out[String(r[1])] = { state: String(r[3]), at: String(r[4]) };
  });
  return out;
}

/** {action:'driverList', key, date?} → 그날 수거 목록 */
function driverList_(b) {
  if (!checkDriverKey_(b.key)) return { ok: false, error: 'forbidden' };
  var R = rules_(), now = new Date();
  var date = R.parseYmd(String(b.date || '')) ? String(b.date) : driverDefaultDate_(now);
  var items = [];
  var lss = ledgerOpen_(date), sh = lss && ledgerMonthSheet_(lss, date);
  var book = bookData_(), byRid = {};
  for (var j = 1; j < book.data.length; j++) byRid[String(book.data[j][book.col('예약번호')])] = book.data[j];
  var g = function (row, h) { var i = book.col(h); return i >= 0 ? String(row[i] == null ? '' : row[i]) : ''; };
  var st = driverStatus_(date);
  if (sh) {
    var tz = lss.getSpreadsheetTimeZone() || 'GMT', v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (cellYmd_(v[i][LEDGER_COL.date - 1], tz) !== date) continue;
      var name = String(v[i][LEDGER_COL.name - 1] || '').trim();
      if (!name) continue;
      var area = String(v[i][LEDGER_COL.area - 1] || '').trim(), addr = String(v[i][LEDGER_COL.addr - 1] || '').trim();
      var memo = String(v[i][LEDGER_COL.memo - 1] || '');
      var m = /ESD-\d{6}-[A-Z0-9]{4}/.exec(memo), rid = m ? m[0] : '';
      var it = { id: rid || ('K:' + name + '|' + addr), rid: rid, name: name, area: area, addr: addr, memo: memo.replace(/^ESD-\d{6}-[A-Z0-9]{4} 신청페이지 \/ /, ''),
        map: driverMapQuery_(area, addr), src: rid ? '신청페이지' : '카톡·직원' };
      var br = rid && byRid[rid];
      if (br) {
        if (g(br, '확정상태') === '취소') continue;
        it.phone = g(br, '연락처');
        it.road = (g(br, '도로명주소') || g(br, '지번주소')) + ' ' + g(br, '상세주소');
        it.map = g(br, '도로명주소') || g(br, '지번주소') || it.map;
        it.place = g(br, '놓을곳') + (g(br, '놓을곳상세') ? ' (' + g(br, '놓을곳상세') + ')' : '');
        it.entrance = g(br, '공동현관') + (g(br, '공동현관비번') ? ' ' + g(br, '공동현관비번') : '');
        it.amount = g(br, '수거양');
        it.request = g(br, '요청사항');
        it.photo = g(br, '사진방식');
      }
      if (/\[취소\]/.test(memo)) continue;
      it.state = (st[it.id] || {}).state || '';
      items.push(it);
    }
  }
  var wd = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
  return { ok: true, date: date, label: R_dateLabel_(date), zone: (+date.slice(8, 10)) % 2 ? '홀수일 · 한강 남쪽·김포' : '짝수일 · 한강 북쪽·일산·덕양',
    weekend: R.CONFIG.closedWeekdays.indexOf(wd) >= 0, ledger: !!sh, items: items };
}

/** {action:'driverMark', key, date, id, name, state:'완료'|'못함'|''} → 기록 */
function driverMark_(b) {
  if (!checkDriverKey_(b.key)) return { ok: false, error: 'forbidden' };
  var date = String(b.date || ''), id = String(b.id || '').slice(0, 200), state = String(b.state || '');
  if (!rules_().parseYmd(date) || !id || ['완료', '못함', ''].indexOf(state) < 0) return { ok: false, error: 'bad_request' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(SHEET_DRIVER, DRIVER_LOG_HEADERS);
    sh.appendRow([date, id, String(b.name || '').slice(0, 40), state || '되돌림', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')]);
  } finally { lock.releaseLock(); }
  // 픽업 완료 알림톡 (신청페이지 예약만, 같은 예약은 한 번만)
  if (state === '완료' && /^ESD-\d{6}-[A-Z0-9]{4}$/.test(id)) { try { alimPicked_(id); } catch (e) { logError_('알림톡(픽업 완료)', e); } }
  return { ok: true };
}

/** 점검 메일용: 그날 완료/못함/전체 */
function driverSummary_(date) {
  var st = driverStatus_(date), done = 0, fail = 0;
  Object.keys(st).forEach(function (k) { if (st[k].state === '완료') done++; else if (st[k].state === '못함') fail++; });
  return { done: done, fail: fail };
}

function menuDriverKey_() {
  var ui = SpreadsheetApp.getUi();
  var cur = PropertiesService.getScriptProperties().getProperty('DRIVER_KEY');
  if (cur && ui.alert('기사님 코드', '지금 코드: ' + cur + '\n\n새 코드로 바꿀까요? (바꾸면 기사님 휴대폰에서 새 코드를 다시 넣어야 해요)', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert('새 기사님 코드: ' + newDriverKey_() + '\n\nesuda.kr/driver 에서 이 코드를 넣으면 돼요.');
}

/** 기사님 화면 설치 (한 번 실행) — 코드는 로그에 남기지 않음. 메뉴 '이수다 → 기사님 코드 보기·바꾸기'에서 확인 */
function setupDriver() {
  if (!PropertiesService.getScriptProperties().getProperty('DRIVER_KEY')) newDriverKey_();
  sheet_(SHEET_DRIVER, DRIVER_LOG_HEADERS).setFrozenRows(1);
  Logger.log('기사님 화면 준비 완료 — 코드는 예약 서버 시트 메뉴 이수다 → 기사님 코드 보기·바꾸기 에서 확인');
}
