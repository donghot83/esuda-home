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

/* 2026-11-17 속도: 만든 목록을 서버 캐시에 보관 → 저장본을 바로 주고(cached:true), 화면이 뒤에서 fresh 로 다시 받아 최신화.
 * 완료·사진·준비완료·장부 추가·동선 확정 때 그날 것을 지우고, [새로고침]은 항상 새로 만든다(fresh). */
var DRIVER_CACHE_SEC = 1800; // 2026-11-17: 장부 파일 열기가 0.3~4초라 저장본을 먼저 주고, 화면이 뒤에서 fresh 로 최신화
function driverCacheClear_(date) { try { var d = fmtDate_(date); CacheService.getScriptCache().removeAll(['drv_' + d, 'wgh_' + d]); } catch (e) {} }   // 계량 화면 목록(wgh_)도 같이

/** {action:'driverList', key, date?, fresh?} → 그날 수거 목록 */
function driverList_(b) {
  if (!checkDriverKey_(b.key)) return { ok: false, error: 'forbidden' };
  var R = rules_(), now = new Date();
  var date = R.parseYmd(String(b.date || '')) ? String(b.date) : driverDefaultDate_(now);
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache && !b.fresh) {
    var hit = cache.get('drv_' + date);
    if (hit) { try { var o = JSON.parse(hit); o.cached = true; return o; } catch (e) {} }
  }
  var out = driverListBuild_(date, R);
  if (cache) { try { var js = JSON.stringify(out); if (js.length < 95000) cache.put('drv_' + date, js, DRIVER_CACHE_SEC); } catch (e) {} }
  return out;
}

function driverListBuild_(date, R) {
  var items = [];
  var lss = ledgerOpen_(date), sh = lss && ledgerMonthSheet_(lss, date);
  var book = bookData_(), byRid = {};
  for (var j = 1; j < book.data.length; j++) byRid[String(book.data[j][book.col('예약번호')])] = book.data[j];
  var g = function (row, h) { var i = book.col(h); return i >= 0 ? String(row[i] == null ? '' : row[i]) : ''; };
  var st = driverStatus_(date), pc = pickPhotoCounts_(date);
  if (sh) {
    var tz = lss.getSpreadsheetTimeZone() || 'GMT', v = sh.getDataRange().getValues(), LC = ledgerCols_(sh, v);
    for (var i = 1; i < v.length; i++) {
      if (cellYmd_(v[i][LEDGER_COL.date - 1], tz) !== date) continue;
      var name = String(v[i][LEDGER_COL.name - 1] || '').trim();
      if (!name) continue;
      var area = String(v[i][LEDGER_COL.area - 1] || '').trim(), addr = String(v[i][LEDGER_COL.addr - 1] || '').trim();
      var memo = String(v[i][LC.memo - 1] || '');
      var m = /ESD-\d{6}-[A-Z0-9]{4}/.exec(memo), rid = m ? m[0] : '';
      var cm = /^\[취소\s*([^\]]*)\]\s*/.exec(memo); if (cm) memo = memo.slice(cm[0].length);
      var it = { no: v[i][LEDGER_COL.no - 1] || '', id: rid || ('K:' + name + '|' + addr), rid: rid, name: name, area: area, addr: addr, memo: memo.replace(/^ESD-\d{6}-[A-Z0-9]{4} 신청페이지 \/ /, ''),
        map: driverMapQuery_(area, addr), src: rid ? '신청페이지' : '카톡·직원' };
      var br = rid && byRid[rid];
      if (br) {
        if (g(br, '확정상태') === '취소' && !cm) cm = [null, g(br, '취소일시').slice(5)];
        it.phone = g(br, '연락처');
        it.road = (g(br, '도로명주소') || g(br, '지번주소')) + ' ' + g(br, '상세주소');
        it.map = g(br, '도로명주소') || g(br, '지번주소') || it.map;
        it.place = g(br, '놓을곳') + (g(br, '놓을곳상세') ? ' (' + g(br, '놓을곳상세') + ')' : '');
        it.entrance = g(br, '공동현관') + (g(br, '공동현관비번') ? ' ' + g(br, '공동현관비번') : '');
        it.amount = g(br, '수거양');
        it.request = g(br, '요청사항');
        it.photo = g(br, '사진방식');
        it.ready = g(br, '준비완료');
      }
      it.state = (st[it.id] || {}).state || '';
      it.photos = pc[it.id] || 0;
      if (cm) { it.cancelled = true; it.cancelAt = cm[1] || ''; it.state = '취소'; delete it.phone; delete it.entrance; }
      items.push(it);
    }
  }
  var wd = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
  var rd = PropertiesService.getScriptProperties().getProperty('ROUTE_DONE_' + date) || '';
  // 지도용 좌표 (좌표 탭에 저장된 것 재사용) + 확정 전이면 동선 미리보기 순서
  var start = null, preview = false;
  try {
    var g0 = geocode_(DRIVER_START_ADDR, '마포구'); if (g0.src) start = { lat: g0.lat, lng: g0.lng, label: '출발 (모래내로3길 7)' };
    items.forEach(function (it) { if (it.cancelled) return; var g = geocode_(it.map, it.area); if (g.src) { it.lat = g.lat; it.lng = g.lng; it.geo = g.src; } });
    if (!rd) {
      var located = items.filter(function (it) { return it.lat && !it.cancelled; });
      var an = ROUTE_ANCHORS[(+date.slice(8, 10)) % 2 ? 'odd' : 'even'];
      routeOrder_(located, an.from, an.to).forEach(function (k, n) { located[k].pv = n + 1; });
      preview = located.length > 1;
    }
  } catch (e) { logError_('기사님 지도', e); }
  return { ok: true, date: date, label: R_dateLabel_(date), route: rd ? ('동선 확정 ' + rd + ' · ' + ((+date.slice(8, 10)) % 2 ? '김포 → 강동' : '일산 → 광진')) : '', zone: (+date.slice(8, 10)) % 2 ? '홀수일 · 한강 남쪽·김포' : '짝수일 · 한강 북쪽·일산·덕양',
    weekend: R.CONFIG.closedWeekdays.indexOf(wd) >= 0, ledger: !!sh, items: items, start: start, preview: preview };
}

/** {action:'driverMark', key, date, id, name, state:'완료'|'못함'|''} → 기록 */
function driverMark_(b) {
  if (!checkDriverKey_(b.key)) return { ok: false, error: 'forbidden' };
  var date = String(b.date || ''), id = String(b.id || '').slice(0, 200), state = String(b.state || '');
  if (!rules_().parseYmd(date) || !id || ['완료', '못함', ''].indexOf(state) < 0) return { ok: false, error: 'bad_request' };
  sheet_(SHEET_DRIVER, DRIVER_LOG_HEADERS)  // 한 줄 추가라 잠금 없이 (신청을 막지 않게)
    .appendRow([date, id, String(b.name || '').slice(0, 40), state || '되돌림', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')]);
  driverCacheClear_(date);
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

/* ===== 기사님 수거 사진 (2026-11-16) =====
 * [수거 완료] 때 기사님이 물품 사진을 찍어 올린다 → 대표 드라이브 '이수다 수거사진' 폴더(비공개)에 저장, '수거사진' 탭에 기록.
 * 신청페이지 예약이면 예약 시트 '수거사진코드'(무작위 12자)를 만들고, 픽업 완료 알림톡 [수거 사진 보기] 버튼
 * → esuda.kr/photo/?c=코드 → pickupPhoto_ 가 사진만 돌려준다 (이름·주소·연락처 없음).
 */
var SHEET_PICKPHOTO = '수거사진';
var PICKPHOTO_HEADERS = ['수거일', 'ID', '이름', '파일ID', '시각'];
var PICKPHOTO_MAX = 3;

function pickPhotoRows_() {
  var sh = ss_().getSheetByName(SHEET_PICKPHOTO);
  return sh ? sh.getDataRange().getValues().slice(1) : [];
}
/** 그 예약(ID)의 사진 파일ID들 (date 없으면 날짜 상관없이) */
function pickPhotos_(date, id) {
  return pickPhotoRows_().filter(function (r) { return String(r[1]) === id && (!date || fmtDate_(r[0]) === date); })
    .map(function (r) { return String(r[3]); });
}
function pickPhotoCounts_(date) {
  var out = {};
  pickPhotoRows_().forEach(function (r) { if (fmtDate_(r[0]) === date) out[String(r[1])] = (out[String(r[1])] || 0) + 1; });
  return out;
}
/** 예약 시트 '수거사진코드' — 없으면 만든다(create). 반환 코드 | '' */
function pickPhotoCode_(rid, create) {
  var sh = sheet_(SHEET_BOOK, BOOK_HEADERS), hdr = ensureBookHeaders_(sh, ['수거사진코드']);
  var v = sh.getDataRange().getValues(), cId = hdr.indexOf('예약번호'), cC = hdr.indexOf('수거사진코드');
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][cId]) !== rid) continue;
    var code = String(v[i][cC] || '');
    if (!code && create) {
      var a = 'abcdefghjkmnpqrstuvwxyz23456789';
      for (var k = 0; k < 12; k++) code += a.charAt(Math.floor(Math.random() * a.length));
      sh.getRange(i + 1, cC + 1).setValue(code);
    }
    return code;
  }
  return '';
}

/** {action:'driverPhoto', key, date, id, name, data(base64 JPEG)} → {ok, count} */
function driverPhoto_(b) {
  if (!checkDriverKey_(b.key)) return { ok: false, error: 'forbidden' };
  var date = String(b.date || ''), id = String(b.id || '').slice(0, 200), name = String(b.name || '').slice(0, 40);
  var data = String(b.data || '').replace(/^data:image\/\w+;base64,/, '');
  if (!rules_().parseYmd(date) || !id) return { ok: false, error: 'bad_request' };
  if (!data || data.length > PHOTO_MAX_B64) return { ok: false, error: 'too_large' };
  var n = pickPhotos_(date, id).length;
  if (n >= PICKPHOTO_MAX) return { ok: false, error: 'too_many' };
  var rid = /^ESD-\d{6}-[A-Z0-9]{4}$/.test(id) ? id : '';
  var tag = rid || (name.replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 20) || '카톡');
  var file = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', '수거_' + date + '_' + tag + '_' + (n + 1) + '.jpg'));
  sheet_(SHEET_PICKPHOTO, PICKPHOTO_HEADERS).appendRow([date, id, name, file.getId(), Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')]);
  driverCacheClear_(date);
  if (rid) { try { pickPhotoCode_(rid, true); } catch (e) { logError_('수거사진 코드', e); } }
  return { ok: true, count: n + 1 };
}

/** {action:'pickupPhoto', code} → {ok, date, photos:[base64…]} — 고객용, 개인정보 없음 */
function pickupPhoto_(b) {
  var code = String(b && b.code || '').trim();
  if (!/^[a-z0-9]{12}$/.test(code)) return { ok: false, error: 'bad_code' };
  var bk = bookData_(), cC = bk.col('수거사진코드');
  if (cC < 0) return { ok: false, error: 'not_found' };
  for (var i = 1; i < bk.data.length; i++) {
    if (String(bk.data[i][cC]) !== code) continue;
    var rid = String(bk.data[i][bk.col('예약번호')]), photos = [], weigh = [], loss = [];
    var b64 = function (fid) { try { return Utilities.base64Encode(DriveApp.getFileById(fid).getBlob().getBytes()); } catch (e) { return ''; } };
    pickPhotos_(null, rid).slice(0, PICKPHOTO_MAX).forEach(function (fid) { var d = b64(fid); if (d) photos.push(d); });
    // 2026-11-17: 센터 계량 사진·로스 사진 (입금 예정 알림톡 [계량 사진 보기])
    var lossKg = '';
    if (typeof weighPhotos_ === 'function') {
      var rec = weighRecords_()[fmtDate_(bk.data[i][bk.col('수거일')]) + '|' + rid];
      var isFree = !!(rec && rec.at && (+rec.weight || 0) - (+rec.excl || 0) - (+rec.loss || 0) < FREE_UNDER_KG);   // 무상수거면 계근 사진만
      weighPhotos_(null, rid).forEach(function (p) { if (isFree && p.kind === '로스') return; var arr = p.kind === '로스' ? loss : weigh; if (arr.length < 4) { var d = b64(p.fileId); if (d) arr.push(d); } });
      if (!isFree && rec && rec.lossDone && +rec.loss > 0) lossKg = +rec.loss;
      var exclKg = !isFree && rec && rec.lossDone && +rec.excl > 0 ? +rec.excl : '';
    }
    return { ok: true, date: R_dateLabel_(bk.data[i][bk.col('수거일')]), photos: photos, weigh: weigh, loss: loss, lossKg: lossKg, exclKg: exclKg || '', lossUnit: lossUnitPrice_(), free: !!isFree };
  }
  return { ok: false, error: 'not_found' };
}

/** 5분 동기화 때: 기사님 근무 시간(15시~새벽 4시)이면 오늘·다음 날 목록을 캐시에 미리 (반환: 만든 날짜 수) */
function warmDriverCache_(now) {
  var R = rules_(), h = R.hourKST(now);
  if (!(h >= 15 || h < 4)) return 0;
  var d = driverDefaultDate_(now), cache = CacheService.getScriptCache(), n = 0;
  [d, R.addDays(d, 1)].forEach(function (x) {
    var js = JSON.stringify(driverListBuild_(x, R));
    if (js.length < 95000) { cache.put('drv_' + x, js, DRIVER_CACHE_SEC); n++; }
  });
  return n;
}
