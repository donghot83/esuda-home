/**
 * 수거 동선 자동 짜기 (2026-11-15 대표 결정)
 *  - 홀수날: 김포 쪽에서 시작해 강동 쪽으로 / 짝수날: 일산 쪽에서 시작해 광진 쪽으로 (한 방향으로 훑기)
 *  - 기사님 출발지: 모래내로3길 7 (안내용)
 *  - 방법: 주소 → 좌표(구글 지도 Geocoder, 키 필요 없음, '좌표' 탭에 저장해 재사용)
 *          시작점·끝점을 고정하고 가장 짧은 순서 계산(가까운 곳부터 + 2-opt 다듬기)
 *  - 결과: 장부의 그날 줄을 그 순서로 정렬하고 1번부터 번호 → '확정'(이후 취소·추가로 번호가 밀리지 않음)
 *  - 매일 17:05 자동 (그날 신청 마감 직후), 메뉴로 다시 짤 수 있음(확정 후엔 경고)
 * 좌표를 못 찾은 주소는 그 구의 구청 좌표로 대신하고 메일·화면에 '확인 필요'로 표시.
 */

var DRIVER_START_ADDR = '서울 모래내로3길 7';
var ROUTE_ANCHORS = {
  odd:  { from: { name: '김포', lat: 37.6153, lng: 126.7157 }, to: { name: '강동', lat: 37.5301, lng: 127.1238 } },
  even: { from: { name: '일산', lat: 37.6753, lng: 126.7510 }, to: { name: '광진', lat: 37.5385, lng: 127.0823 } }
};
// 구청 좌표(대략) — 주소 좌표를 못 찾을 때 대신 씀
var GU_CENTER = {
  '강서구': [37.5509, 126.8495], '양천구': [37.5170, 126.8664], '구로구': [37.4954, 126.8875], '금천구': [37.4569, 126.8955],
  '영등포구': [37.5264, 126.8962], '동작구': [37.5124, 126.9393], '관악구': [37.4784, 126.9516], '서초구': [37.4837, 127.0324],
  '강남구': [37.5172, 127.0473], '송파구': [37.5145, 127.1059], '강동구': [37.5301, 127.1238], '은평구': [37.6027, 126.9291],
  '마포구': [37.5663, 126.9019], '서대문구': [37.5791, 126.9368], '종로구': [37.5735, 126.9790], '중구': [37.5641, 126.9979],
  '용산구': [37.5326, 126.9905], '성동구': [37.5634, 127.0369], '광진구': [37.5385, 127.0823], '동대문구': [37.5744, 127.0400],
  '성북구': [37.5894, 127.0167], '강북구': [37.6396, 127.0257], '도봉구': [37.6688, 127.0471], '노원구': [37.6542, 127.0568],
  '중랑구': [37.6066, 127.0927], '김포시': [37.6153, 126.7157], '고양시': [37.6377, 126.8320], '일산동구': [37.6585, 126.7748],
  '일산서구': [37.6753, 126.7510], '덕양구': [37.6377, 126.8320]
};
var SHEET_GEO = '좌표';

function inMetro_(lat, lng) { return lat > 37.35 && lat < 37.80 && lng > 126.60 && lng < 127.25; }

/** 주소 → {lat, lng, src:'지도'|'구청'|''} (좌표 탭에 저장) */
// 2026-11-17 속도: 좌표 탭을 사람마다 다시 읽던 것(18명이면 18번) → 한 번 읽어 기억
var GEO_MEMO_ = null;
function geocode_(query, area) {
  query = String(query || '').replace(/\s+/g, ' ').trim();
  if (!GEO_MEMO_) {
    GEO_MEMO_ = {};
    sheet_(SHEET_GEO, ['주소', '위도', '경도', '출처', '시각']).getDataRange().getValues().slice(1).forEach(function (r) { if (+r[1] && !GEO_MEMO_[String(r[0])]) GEO_MEMO_[String(r[0])] = { lat: +r[1], lng: +r[2], src: String(r[3]) }; });
  }
  if (GEO_MEMO_[query]) return GEO_MEMO_[query];
  var out = null;
  try {
    var res = Maps.newGeocoder().setRegion('kr').setLanguage('ko').geocode(query);
    var r = res && res.results && res.results[0];
    if (r && r.geometry && r.geometry.location && inMetro_(r.geometry.location.lat, r.geometry.location.lng)) {
      out = { lat: r.geometry.location.lat, lng: r.geometry.location.lng, src: '지도' };
    }
  } catch (e) { logError_('좌표 찾기', e); }
  if (!out) { var gu = guCenter_(query, area); if (gu) out = { lat: gu[0], lng: gu[1], src: '구청' }; } // 못 찾은 곳도 저장 → 매번 지도 검색 안 함
  if (!out) return { lat: 0, lng: 0, src: '' };
  sheet_(SHEET_GEO, ['주소', '위도', '경도', '출처', '시각']).appendRow([query, out.lat, out.lng, out.src, Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')]);
  GEO_MEMO_[query] = out;
  return out;
}

function guCenter_(query, area) {
  var keys = Object.keys(GU_CENTER).sort(function (a, b) { return b.length - a.length; });
  for (var k = 0; k < keys.length; k++) if (String(query).indexOf(keys[k]) >= 0) return GU_CENTER[keys[k]];
  return GU_CENTER[String(area || '').trim()] || null;
}

/** 두 지점 거리(km, 근사) */
function dist_(a, b) {
  var x = (b.lng - a.lng) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180) * 111.32, y = (b.lat - a.lat) * 110.57;
  return Math.sqrt(x * x + y * y);
}

/** 시작 S·끝 E 고정, pts 모두 방문하는 짧은 순서 → pts 인덱스 배열 */
function routeOrder_(pts, S, E) {
  var n = pts.length;
  if (n <= 1) return pts.map(function (_, i) { return i; });
  var left = pts.map(function (_, i) { return i; }), path = [], cur = S;
  while (left.length) { // 가까운 곳부터 (끝점 쪽으로 조금 끌리게: 남은 거리 일부 반영)
    var best = 0, bd = Infinity;
    for (var j = 0; j < left.length; j++) {
      var p = pts[left[j]], d = dist_(cur, p) + 0.15 * dist_(p, E);
      if (d < bd) { bd = d; best = j; }
    }
    cur = pts[left[best]]; path.push(left.splice(best, 1)[0]);
  }
  // 끝은 열어 둠: 마지막 집에서 끝남 (끝점 E 는 방향 잡기에만 사용)
  var node = function (k) { return k < 0 ? S : (k >= n ? null : pts[path[k]]); };
  var dd = function (a, b) { return a && b ? dist_(a, b) : 0; };
  var improved = true, guard = 0;
  while (improved && guard++ < 200) { // 2-opt (양 끝 고정)
    improved = false;
    for (var a = 0; a < n - 1; a++) for (var b = a + 1; b < n; b++) {
      var before = dd(node(a - 1), node(a)) + dd(node(b), node(b + 1));
      var after = dd(node(a - 1), node(b)) + dd(node(a), node(b + 1));
      if (after + 1e-9 < before) { path = path.slice(0, a).concat(path.slice(a, b + 1).reverse(), path.slice(b + 1)); improved = true; }
    }
  }
  return path;
}

function routeTotalKm_(pts, order, S, E) {
  var km = 0, prev = S;
  order.forEach(function (i) { km += dist_(prev, pts[i]); prev = pts[i]; });
  return km;
}

function routeKey_(date) { return 'ROUTE_DONE_' + date; }
function routeDone_(date) { return PropertiesService.getScriptProperties().getProperty(routeKey_(date)) || ''; }

/**
 * 그날 동선 짜기 → 장부 정렬·번호 확정. opts.force: 이미 확정된 날도 다시 / opts.dryRun: 순서만 계산
 * 반환 {ok, date, count, km, order:[{no,name,area,src}], fallback:[이름], msg}
 */
function routeDate(date, opts) {
  opts = opts || {};
  var R = rules_();
  date = String(date || R.todayKST(new Date()));
  if (!R.parseYmd(date)) return { ok: false, msg: '날짜를 확인해 주세요' };
  if (routeDone_(date) && !opts.force && !opts.dryRun) return { ok: false, already: true, msg: dayLabel_(date) + ' 동선은 이미 확정됐어요 (' + routeDone_(date) + ')' };
  var lss = ledgerOpen_(date), sh = lss && ledgerMonthSheet_(lss, date);
  if (!sh) return { ok: false, msg: '장부에 이 달 시트가 없어요' };
  var tz = lss.getSpreadsheetTimeZone() || 'GMT';
  var lock = ledgerLock_();
  if (!lock.tryLock(20000)) return { ok: false, msg: '잠시 뒤 다시 해 주세요' };
  try {
    var v = sh.getDataRange().getValues(), rows = [];
    for (var i = 1; i < v.length; i++) {
      if (cellYmd_(v[i][LEDGER_COL.date - 1], tz) !== date || !String(v[i][LEDGER_COL.name - 1] || '').trim()) continue;
      rows.push(i);
    }
    if (!rows.length) return { ok: true, date: date, count: 0, order: [], fallback: [], msg: dayLabel_(date) + ' 수거 예약이 없어요' };
    var first = rows[0], last = rows[rows.length - 1];
    if (last - first + 1 !== rows.length) return { ok: false, msg: dayLabel_(date) + ' 줄 사이에 다른 줄(빈 줄 등)이 끼어 있어서 정렬하지 않았어요. 그날 줄을 붙여 주세요.' };
    var book = bookData_(), byRid = {};
    for (var j = 1; j < book.data.length; j++) byRid[String(book.data[j][book.col('예약번호')])] = book.data[j];
    var items = rows.map(function (i) {
      var memo = String(v[i][LEDGER_COL.memo - 1] || ''), area = String(v[i][LEDGER_COL.area - 1] || ''), addr = String(v[i][LEDGER_COL.addr - 1] || '');
      var rid = (/ESD-\d{6}-[A-Z0-9]{4}/.exec(memo) || [])[0], br = rid && byRid[rid];
      var q = br ? String(br[book.col('도로명주소')] || br[book.col('지번주소')] || '') : '';
      if (!q) q = driverMapQuery_(area, addr);
      return { i: i, name: String(v[i][LEDGER_COL.name - 1]), area: area, q: q, cancelled: /^\[취소/.test(memo), key: memo + '|' + v[i][LEDGER_COL.name - 1] + '|' + addr };
    });
    var live = items.filter(function (x) { return !x.cancelled; }), dead = items.filter(function (x) { return x.cancelled; });
    live.forEach(function (x) { var g = geocode_(x.q, x.area); x.lat = g.lat; x.lng = g.lng; x.src = g.src; });
    var an = ROUTE_ANCHORS[(+date.slice(8, 10)) % 2 ? 'odd' : 'even'];
    var located = live.filter(function (x) { return x.src; }), unknown = live.filter(function (x) { return !x.src; });
    var order = routeOrder_(located, an.from, an.to).map(function (k) { return located[k]; }).concat(unknown, dead);
    var km = routeTotalKm_(located, routeOrder_(located, an.from, an.to), an.from, an.to);
    var res = { ok: true, date: date, count: live.length, km: Math.round(km), from: an.from.name, to: an.to.name,
      order: order.map(function (x, k) { return { no: k + 1, name: x.name, area: x.area, src: x.src || '', cancelled: x.cancelled }; }),
      fallback: live.filter(function (x) { return x.src !== '지도'; }).map(function (x) { return x.name + '(' + x.area + ')'; }) };
    if (opts.dryRun) return res;
    // 장부 정렬: 원하는 순서대로 한 줄씩 제자리로 옮김 (서식·취소선도 같이 이동)
    var pos = items.map(function (x) { return x.key; }); // 현재 순서 (block 안)
    for (var k = 0; k < order.length; k++) {
      var at = pos.indexOf(order[k].key);
      if (at === k) continue;
      var src = first + 1 + at; // 1-based 시트 행
      sh.moveRows(sh.getRange(src, 1, 1, sh.getMaxColumns()), first + 1 + k);
      pos.splice(k, 0, pos.splice(at, 1)[0]);
    }
    renumberLedgerDate_(sh, date, tz);
    var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd HH:mm');
    PropertiesService.getScriptProperties().setProperty(routeKey_(date), stamp);
    driverCacheClear_(date);
    res.msg = dayLabel_(date) + ' 동선 확정: ' + an.from.name + ' → ' + an.to.name + ', ' + live.length + '곳, 약 ' + res.km + 'km';
    return res;
  } finally { lock.releaseLock(); }
}

/** 매일 17:05 자동 — 오늘(평일·주말예외) 동선 확정 후 대표 메일 */
function dailyRoute() {
  var R = rules_(), now = new Date(), today = R.todayKST(now), sc = loadSchedule_();
  var wd = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))).getUTCDay();
  if (R.CONFIG.closedWeekdays.indexOf(wd) >= 0 && sc.openDates.indexOf(today) < 0) return;
  try { syncLedgerPending(); } catch (e) { logError_('동선 전 장부 반영', e); } // 막 들어온 신청까지 장부에 넣고 짜기
  var r = routeDate(today);
  try { refreshDashboard(); } catch (e) {}
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS');
  if (!to || r.already) return r;
  var body = !r.ok ? ['동선을 자동으로 짜지 못했어요: ' + r.msg, '', '예약 서버 시트 메뉴 이수다 → 오늘 동선 짜기 로 다시 해 주세요.']
    : !r.count ? [r.msg] : [
      r.msg, '(기사님 출발지: ' + DRIVER_START_ADDR + ')', '',
      r.order.map(function (x) { return x.no + '. ' + x.name + ' (' + x.area + ')' + (x.cancelled ? ' — 취소' : '') + (x.src === '구청' ? ' ※주소 확인 필요' : ''); }).join('\n'), '',
      r.fallback.length ? '※ 주소 좌표를 정확히 못 찾아 구 단위로 넣은 곳: ' + r.fallback.join(', ') + ' — 순서가 이상하면 장부에서 줄을 옮기고 메뉴 "장부 번호 다시 매기기"를 눌러 주세요.' : '',
      '기사님 화면(esuda.kr/driver)에 이 순서대로 나와요. 이제 번호는 봉투 번호로 고정돼요.'];
  MailApp.sendEmail({ to: to, subject: '[이수다 동선] ' + dayLabel_(today) + ' ' + (r.ok ? (r.count || 0) + '곳 확정' : '확인 필요'), body: body.join('\n') });
  return r;
}

function menuRoute_() {
  var ui = SpreadsheetApp.getUi(), R = rules_(), today = R.todayKST(new Date());
  var p = ui.prompt('동선 짜기', '날짜를 넣어 주세요 (비우면 오늘 ' + dayLabel_(today) + ')\n예: 11/17', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var t = p.getResponseText().trim(), date = today, m = /^(\d{1,2})[\/.-](\d{1,2})$/.exec(t);
  if (m) date = today.slice(0, 4) + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  var force = false;
  if (routeDone_(date)) {
    if (ui.alert('이미 확정된 날', dayLabel_(date) + ' 동선은 ' + routeDone_(date) + '에 확정됐어요.\n다시 짜면 번호(봉투 번호)가 바뀌어요. 기사님께 목록을 보내기 전일 때만 다시 짜세요.\n다시 짤까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    force = true;
  }
  var r = routeDate(date, { force: force });
  ui.alert(r.ok ? r.msg + '\n\n' + r.order.map(function (x) { return x.no + '. ' + x.name + ' (' + x.area + ')' + (x.cancelled ? ' 취소' : ''); }).join('\n') + (r.fallback && r.fallback.length ? '\n\n※ 주소 확인 필요: ' + r.fallback.join(', ') : '') : r.msg);
  try { refreshDashboard(); } catch (e) {}
}

/** 동선 설치 (한 번) — 매일 17:05 자동 */
function setupRoute() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyRoute') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyRoute').timeBased().atHour(17).nearMinute(5).everyDays(1).inTimezone('Asia/Seoul').create();
  var g = geocode_(DRIVER_START_ADDR, '서대문구');
  Logger.log('동선 준비 완료 / 출발지 좌표: ' + g.lat + ',' + g.lng + ' (' + g.src + ')');
}
