/**
 * 계량 화면 (2026-11-17) — esuda.kr/weigh/ 에서 직원이 센터 계량 결과를 넣는다.
 *
 * ① 계량: 고객(장부 번호-봉지 수, 예 1-3)을 골라 봉지 수·무게 입력 + 계량 사진(폰 갤러리에서 고름)
 *     → 장부 '무게'(F) 칸에 기록. 장부에 이미 값이 있고 다르면 '덮어쓸까요?'를 먼저 물어봄(이중 체크).
 * ② 로스: 나중에 따로(당일·다음 날 OK). '로스 없음' 또는 kg + 로스 사진 → 장부 '로스'(G) 칸.
 *     계량 화면으로 계량한 신청페이지 예약은 로스를 확인하기 전까지 이체 파일에서 빠진다('로스 미정').
 * ③ 정산 검토표(메뉴): 무게·로스·금액·사진 수·경고를 한 장에 → 사람이 엑셀로 최종 확인.
 * ④ 이체 파일 만들 때만 입금 예정 알림톡 — 계량 사진이 있고 TPL_PAID_PHOTO 가 있으면 [계량 사진 보기] 버튼.
 *
 * 보안: 스크립트 속성 WEIGH_KEY (기사님 코드와 따로). 연락처·계좌는 이 화면에 보내지 않는다.
 * 사진: 대표 드라이브 '이수다 계량사진' 폴더(비공개) — 파일 이름 '2026-11-16 1-3 이름 계량1.jpg' (날짜·번호순 정렬)
 */

var SHEET_WEIGH = '계량';
var WEIGH_HEADERS = ['수거일', 'ID', '번호', '이름', '봉지', '무게', '계량시각', '로스', '로스확인', '로스시각', '무상제외'];   // 2026-11-17 무상제외 추가(끝에)
var SHEET_WEIGH_PHOTO = '계량사진';
var WEIGH_PHOTO_HEADERS = ['수거일', 'ID', '이름', '종류', '파일ID', '시각'];
var WEIGH_FOLDER_NAME = '이수다 계량사진';
var WEIGH_PHOTO_MAX = 6;   // 고객·종류별

function checkWeighKey_(key) {
  var k = PropertiesService.getScriptProperties().getProperty('WEIGH_KEY');
  return !!k && String(key || '').trim().toUpperCase() === k;
}
function newWeighKey_() {
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 10; i++) s += a.charAt(Math.floor(Math.random() * a.length));
  PropertiesService.getScriptProperties().setProperty('WEIGH_KEY', s);
  return s;
}
function menuWeighKey_() {
  var ui = SpreadsheetApp.getUi();
  var cur = PropertiesService.getScriptProperties().getProperty('WEIGH_KEY');
  if (cur && ui.alert('계량 화면 코드', '지금 코드: ' + cur + '\n\n새 코드로 바꿀까요? (바꾸면 직원 휴대폰에서 새 코드를 다시 넣어야 해요)', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert('새 계량 화면 코드: ' + newWeighKey_() + '\n\nesuda.kr/weigh 에서 이 코드를 넣으면 돼요.');
}

function weighFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('WEIGH_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(WEIGH_FOLDER_NAME);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(WEIGH_FOLDER_NAME);
  props.setProperty('WEIGH_FOLDER_ID', f.getId());
  return f;
}

/** 장부에서 그날 줄들 → [{row, id, rid, no, name, area, weight, loss, amount, cancelled}] (기사님 화면과 같은 ID) */
function weighLedgerRows_(date) {
  var lss = ledgerOpen_(date), sh = lss && ledgerMonthSheet_(lss, date);
  if (!sh) return { sh: null, rows: [] };
  var tz = lss.getSpreadsheetTimeZone() || 'GMT', v = sh.getDataRange().getValues(), out = [], LC = ledgerCols_(sh, v);
  for (var i = 1; i < v.length; i++) {
    if (cellYmd_(v[i][LEDGER_COL.date - 1], tz) !== date) continue;
    var name = String(v[i][LEDGER_COL.name - 1] || '').trim();
    if (!name) continue;
    var addr = String(v[i][LEDGER_COL.addr - 1] || '').trim(), memo = String(v[i][LC.memo - 1] || '');
    var m = /ESD-\d{6}-[A-Z0-9]{4}/.exec(memo), rid = m ? m[0] : '';
    out.push({ row: i + 1, id: rid || ('K:' + name + '|' + addr), rid: rid, no: v[i][LEDGER_COL.no - 1] || '', name: name,
      area: String(v[i][LEDGER_COL.area - 1] || '').trim(), weight: v[i][LEDGER_COL.weight - 1], loss: v[i][LC.loss - 1],
      excl: LC.excl ? v[i][LC.excl - 1] : '', amount: v[i][LC.amount - 1], cancelled: /^\[취소/.test(memo) });
  }
  return { sh: sh, rows: out, cols: LC };
}

/** '계량' 탭 → {key(date|id): {row, bags, weight, at, loss, lossDone, lossAt}} */
function weighRecords_() {
  var sh = ss_().getSheetByName(SHEET_WEIGH), out = {};
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(function (r, i) {
    out[fmtDate_(r[0]) + '|' + String(r[1])] = { row: i + 2, no: r[2], name: String(r[3]), bags: r[4], weight: r[5], at: String(r[6] || ''), loss: r[7], lossDone: String(r[8]) === 'Y', lossAt: String(r[9] || ''), excl: r[10] };
  });
  return out;
}
function weighUpsert_(date, id, fields) {
  var sh = sheet_(SHEET_WEIGH, WEIGH_HEADERS), rec = weighRecords_()[date + '|' + id];
  if (fields['무상제외'] != null) ensureBookHeaders_(sh, ['무상제외']);   // 예전에 만든 탭이면 머리글 붙이기
  var row = rec ? rec.row : sh.getDataRange().getValues().length + 1;
  if (!rec) sh.getRange(row, 1, 1, 2).setValues([[date, id]]);
  Object.keys(fields).forEach(function (h) { sh.getRange(row, WEIGH_HEADERS.indexOf(h) + 1).setValue(fields[h]); });
}
/** '계량사진' 탭 → 그 고객 사진 [{fileId, kind, row}] (date 없으면 날짜 상관없이) */
function weighPhotos_(date, id, kind) {
  var sh = ss_().getSheetByName(SHEET_WEIGH_PHOTO);
  if (!sh) return [];
  var out = [];
  sh.getDataRange().getValues().forEach(function (r, i) {
    if (i && String(r[1]) === id && (!date || fmtDate_(r[0]) === date) && (!kind || String(r[3]) === kind)) out.push({ fileId: String(r[4]), kind: String(r[3]), row: i + 1 });
  });
  return out;
}
/** 무상 희망(신청 때 '계좌 없이 무상' 체크) 예약번호 모음 — 2026-11-17 대표 결정: 사진·로스 없이 무게만, 무상수거 알림톡만 */
function freeWishSet_() {
  var b = bookData_(), c = b.col('무상희망'), out = {};
  if (c < 0) return out;
  for (var i = 1; i < b.data.length; i++) if (String(b.data[i][c]) === '예') out[String(b.data[i][b.col('예약번호')])] = true;
  return out;
}
function weighNow_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'); }
function weighNum_(x) { var s = String(x == null ? '' : x).replace(/[^0-9.]/g, ''); return s === '' ? NaN : +s; }
function sameKg_(a, b) { return Math.abs(+a - +b) < 0.001; }

/** {action:'weighList', key, date?} → 그날 목록 (연락처·주소 없음) */
function weighList_(b) {
  if (!checkWeighKey_(b.key)) return { ok: false, error: 'forbidden' };
  var R = rules_(), date = R.parseYmd(String(b.date || '')) ? String(b.date) : R.addDays(R.todayKST(new Date()), -1);
  // 2026-11-17 속도: 만든 목록을 30분 보관 → 화면이 먼저 보여 주고 뒤에서 fresh 로 최신화. 계량·로스·사진·장부 변경 때 지움(driverCacheClear_)
  var cache = null; try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache && !b.fresh) { var hit = cache.get('wgh_' + date); if (hit) { try { var o = JSON.parse(hit); o.cached = true; return o; } catch (e) {} } }
  var out = weighListBuild_(date, R);
  if (cache) { try { var js = JSON.stringify(out); if (js.length < 95000) cache.put('wgh_' + date, js, 1800); } catch (e) {} }
  return out;
}
function weighListBuild_(date, R) {
  var L = weighLedgerRows_(date), recs = weighRecords_(), pc = {}, free = freeWishSet_();
  var ps = ss_().getSheetByName(SHEET_WEIGH_PHOTO);
  if (ps) ps.getDataRange().getValues().slice(1).forEach(function (r) {
    if (fmtDate_(r[0]) !== date) return;
    var k = String(r[1]); pc[k] = pc[k] || { 계량: 0, 로스: 0 }; pc[k][String(r[3]) === '로스' ? '로스' : '계량']++;
  });
  var items = L.rows.map(function (x) {
    var rec = recs[date + '|' + x.id] || {};
    var num = function (v) { return v === '' || v == null || isNaN(+v) ? '' : +v; };
    return { id: x.id, rid: x.rid ? shortRid_(x.rid) : '', no: x.no, name: x.name, area: x.area, cancelled: x.cancelled,
      ledgerWeight: num(x.weight), ledgerLoss: num(x.loss), ledgerExcl: num(x.excl), amount: typeof x.amount === 'number' ? x.amount : String(x.amount || ''),
      bags: rec.bags === '' || rec.bags == null ? '' : +rec.bags, weighed: !!rec.at, lossDone: !!rec.lossDone, loss: num(rec.loss), free: !!(x.rid && free[x.rid]),
      photos: pc[x.id] || { 계량: 0, 로스: 0 } };
  });
  return { ok: true, date: date, label: R_dateLabel_(date), ledger: !!L.sh, exclCol: !!(L.cols && L.cols.excl), unit: transferUnitPrice_(), lossUnit: lossUnitPrice_(), items: items };
}

function weighFind_(date, id) {
  var L = weighLedgerRows_(date);
  for (var i = 0; i < L.rows.length; i++) if (L.rows[i].id === id) return { sh: L.sh, x: L.rows[i], c: L.cols };
  return null;
}

/** {action:'weighSave', key, date, id, bags, weight, force?} → 장부 무게 칸 + '계량' 탭. 장부 값과 다르면 force 없이는 mismatch */
function weighSave_(b) {
  if (!checkWeighKey_(b.key)) return { ok: false, error: 'forbidden' };
  var date = String(b.date || ''), id = String(b.id || '').slice(0, 200), w = weighNum_(b.weight), bags = weighNum_(b.bags);
  if (!rules_().parseYmd(date) || !id) return { ok: false, error: 'bad_request' };
  if (!(w > 0 && w < 1000)) return { ok: false, error: 'bad_weight' };
  if (!(bags >= 0 && bags < 100)) bags = '';
  var lock = ledgerLock_();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var f = weighFind_(date, id);
    if (!f) return { ok: false, error: 'not_found' };
    if (f.x.cancelled) return { ok: false, error: 'cancelled' };
    var cur = f.x.weight, hasCur = cur !== '' && cur != null && !isNaN(+cur);
    if (hasCur && !sameKg_(cur, w) && !b.force) return { ok: false, error: 'mismatch', ledger: +cur };
    if (!hasCur || !sameKg_(cur, w)) f.sh.getRange(f.x.row, LEDGER_COL.weight).setValue(w);
    weighUpsert_(date, id, { '번호': f.x.no, '이름': f.x.name, '봉지': bags, '무게': w, '계량시각': weighNow_() });
    driverCacheClear_(date);
    return { ok: true, weight: w, bags: bags, changed: hasCur && !sameKg_(cur, w) };
  } finally { lock.releaseLock(); }
}

/** {action:'lossSave', key, date, id, loss(폐기물, 0 = 없음), excl?(무상제외: 박스·이불 등), force?} → 장부 로스·무상제외 칸 + 로스 확인
 *  로스 = 무게에서 빼고 kg당 로스단가 공제 / 무상제외 = 무게에서만 뺌(장부에 '무상제외' 칸이 있어야 함) */
function lossSave_(b) {
  if (!checkWeighKey_(b.key)) return { ok: false, error: 'forbidden' };
  var date = String(b.date || ''), id = String(b.id || '').slice(0, 200), loss = weighNum_(b.loss);
  var excl = b.excl === '' || b.excl == null ? 0 : weighNum_(b.excl);
  if (!rules_().parseYmd(date) || !id) return { ok: false, error: 'bad_request' };
  if (!(loss >= 0 && loss < 1000) || !(excl >= 0 && excl < 1000)) return { ok: false, error: 'bad_loss' };
  var lock = ledgerLock_();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var f = weighFind_(date, id);
    if (!f) return { ok: false, error: 'not_found' };
    if (excl > 0 && !f.c.excl) return { ok: false, error: 'no_excl_col' };
    var w = +f.x.weight;
    if (w > 0 && loss + excl > w) return { ok: false, error: 'loss_over' };
    var n0 = function (v) { return v === '' || v == null || isNaN(+v) ? 0 : +v; };
    var curL = n0(f.x.loss), curX = n0(f.x.excl);
    if (!b.force) {
      if (!sameKg_(curL, loss) && curL > 0) return { ok: false, error: 'mismatch', ledger: curL, what: '로스' };
      if (!sameKg_(curX, excl) && curX > 0) return { ok: false, error: 'mismatch', ledger: curX, what: '무상제외' };
    }
    if (!sameKg_(curL, loss)) f.sh.getRange(f.x.row, f.c.loss).setValue(loss > 0 ? loss : '');
    if (f.c.excl && !sameKg_(curX, excl)) {
      f.sh.getRange(f.x.row, f.c.excl).setValue(excl > 0 ? excl : '');
      if (excl > 0) { try { ensureFinalFormula_(f.sh, f.x.row); } catch (e) { logError_('최종 수식', e); } }
    }
    weighUpsert_(date, id, { '번호': f.x.no, '이름': f.x.name, '로스': loss, '로스확인': 'Y', '로스시각': weighNow_(), '무상제외': excl });
    driverCacheClear_(date);
    return { ok: true, loss: loss, excl: excl };
  } finally { lock.releaseLock(); }
}

/** {action:'weighPhoto', key, date, id, kind:'계량'|'로스', data} → 드라이브 저장 */
function weighPhoto_(b) {
  if (!checkWeighKey_(b.key)) return { ok: false, error: 'forbidden' };
  var date = String(b.date || ''), id = String(b.id || '').slice(0, 200), kind = String(b.kind) === '로스' ? '로스' : '계량';
  var data = String(b.data || '').replace(/^data:image\/\w+;base64,/, '');
  if (!rules_().parseYmd(date) || !id) return { ok: false, error: 'bad_request' };
  if (!data || data.length > PHOTO_MAX_B64) return { ok: false, error: 'too_large' };
  if (/^ESD-/.test(id) && freeWishSet_()[id]) return { ok: false, error: 'free' };   // 무상 희망 고객은 사진 안 올림 (카톡 예약은 확인 안 해도 됨)
  var have = weighPhotos_(date, id, kind).length;
  if (have >= WEIGH_PHOTO_MAX) return { ok: false, error: 'too_many' };
  // 2026-11-17 속도: 이름·번호·봉지는 화면이 보내 줌(없을 때만 기록 읽기), 고객 사진 코드는 알림톡 보낼 때 만듦
  var rec = b.name && b.no ? {} : (weighRecords_()[date + '|' + id] || {});
  var name = String(b.name || rec.name || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 20);
  var no = String(b.no || rec.no || ''), bags = b.bags !== '' && b.bags != null ? b.bags : (rec.bags === '' || rec.bags == null ? '' : rec.bags);
  var seq = +b.seq > 0 ? +b.seq : have + 1;   // 여러 장을 동시에 올려도 번호가 안 겹치게
  var label = (no ? no + (bags !== '' ? '-' + bags : '') + ' ' : '') + name;
  var file = weighFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', date + ' ' + label + ' ' + kind + seq + '.jpg'));
  sheet_(SHEET_WEIGH_PHOTO, WEIGH_PHOTO_HEADERS).appendRow([date, id, name, kind, file.getId(), weighNow_()]);
  driverCacheClear_(date);
  return { ok: true, count: have + 1, fileId: file.getId() };
}

/** {action:'weighPhotoDel', key, fileId} → 잘못 올린 사진 지우기 (휴지통) */
function weighPhotoDel_(b) {
  if (!checkWeighKey_(b.key)) return { ok: false, error: 'forbidden' };
  var fid = String(b.fileId || ''), sh = ss_().getSheetByName(SHEET_WEIGH_PHOTO);
  if (!fid || !sh) return { ok: false, error: 'not_found' };
  var v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][4]) === fid) {
    try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {}
    sh.deleteRow(i + 1);
    driverCacheClear_(v[i][0]);
    return { ok: true };
  }
  return { ok: false, error: 'not_found' };
}

/** {action:'weighThumbs', key, date, id} → 그 고객 사진 [{fileId, kind, data}] (확인용) */
function weighThumbs_(b) {
  if (!checkWeighKey_(b.key)) return { ok: false, error: 'forbidden' };
  var out = weighPhotos_(String(b.date || ''), String(b.id || '')).slice(0, 12).map(function (p) {
    var d = ''; try { d = Utilities.base64Encode(DriveApp.getFileById(p.fileId).getBlob().getBytes()); } catch (e) {}
    return { fileId: p.fileId, kind: p.kind, data: d };
  });
  return { ok: true, photos: out };
}

/** 이체 파일용: 계량 화면으로 계량했는데 로스 확인 전이면 true */
var FREE_UNDER_KG = 15;   // 이 무게 미만이면 무상수거 → 로스 입력 필요 없음 (2026-11-17 대표 결정)
function weighLossPending_(date, rid) {
  if (freeWishSet_()[rid]) return false;   // 무상 희망은 로스 필요 없음
  var rec = weighRecords_()[date + '|' + rid];
  if (rec && rec.at && +rec.weight < FREE_UNDER_KG) return false;   // 15kg 미만도 로스 필요 없음
  return !!(rec && rec.at && !rec.lossDone);
}

/* ===== ③ 정산 검토표 (메뉴) ===== */
/** dates: ['2026-11-16', …] → 검토표 줄 [{…, 경고}] */
function settleReview_(dates) {
  var recs = weighRecords_(), out = [], book = bookData_(), byRid = {}, free = freeWishSet_();
  for (var j = 1; j < book.data.length; j++) byRid[String(book.data[j][book.col('예약번호')])] = book.data[j];
  var ps = ss_().getSheetByName(SHEET_WEIGH_PHOTO), pc = {};
  if (ps) ps.getDataRange().getValues().slice(1).forEach(function (r) {
    var k = fmtDate_(r[0]) + '|' + String(r[1]); pc[k] = pc[k] || { 계량: 0, 로스: 0 }; pc[k][String(r[3]) === '로스' ? '로스' : '계량']++;
  });
  dates.forEach(function (date) {
    weighLedgerRows_(date).rows.forEach(function (x) {
      var rec = recs[date + '|' + x.id] || {}, p = pc[date + '|' + x.id] || { 계량: 0, 로스: 0 }, warn = [];
      var br = x.rid && byRid[x.rid], phone = br ? String(br[book.col('연락처')] || '') : '';
      var w = +x.weight, l = +x.loss || 0;
      var isFree = !!(x.rid && free[x.rid]);
      if (x.cancelled) warn.push('취소');
      else if (isFree) { if (!(w > 0)) warn.push('무게 없음'); }   // 무상 희망: 무게만 있으면 됨
      else {
        if (!(w > 0)) warn.push('무게 없음');
        else if (w < 1 || w > 300) warn.push('무게 확인');
        if (rec.at && !sameKg_(rec.weight, w)) warn.push('장부 무게가 계량 화면과 다름');
        if (w > 0 && (+x.excl || 0) + l > w) warn.push('제외+로스가 무게보다 큼');
        if (!p.계량) warn.push('계량 사진 없음');
        if (rec.at && !rec.lossDone && w >= FREE_UNDER_KG) warn.push('로스 미정');   // 15kg 미만은 로스 필요 없음
        if (l > 0 && !p.로스) warn.push('로스 사진 없음');
      }
      out.push({ '수거일': date, '번호': x.no + (rec.bags !== '' && rec.bags != null ? '-' + rec.bags : ''), '이름': x.name, '구분': x.rid ? (isFree ? '신청페이지(무상 희망)' : '신청페이지') : '카톡·직원',
        '무게': x.weight, '무상제외': x.excl, '로스': x.loss, '금액': x.amount, '계량사진': p.계량, '로스사진': p.로스, '로스확인': rec.lossDone ? '확인' : (rec.at ? '미정' : '-'),
        '알림톡': x.rid && /^01\d{8,9}$/.test(phone.replace(/[^0-9]/g, '')) ? (isFree ? '무상수거 안내' : '보냄') : '안 감(연락처 없음)', '경고': warn.join(', ') });
    });
  });
  return out;
}
var REVIEW_HEADERS = ['수거일', '번호', '이름', '구분', '무게', '무상제외', '로스', '금액', '계량사진', '로스사진', '로스확인', '알림톡', '경고'];
function menuSettleReview_() {
  var ui = SpreadsheetApp.getUi(), R = rules_();
  var p = ui.prompt('정산 검토표', '수거일을 넣어 주세요. 여러 날이면 쉼표로 (예: 11/16 또는 11/16, 11/17)', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var today = R.todayKST(new Date()), dates = p.getResponseText().split(/[,\s]+/).filter(Boolean).map(function (s) {
    var m = /^(?:(\d{4})[-./])?(\d{1,2})[-./](\d{1,2})$/.exec(s.trim());
    return m ? (m[1] || today.slice(0, 4)) + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
  }).filter(function (d) { return R.parseYmd(d); });
  if (!dates.length) { ui.alert('날짜를 "11/16"처럼 넣어 주세요.'); return; }
  var rows = settleReview_(dates), sh = sheet_('정산검토', REVIEW_HEADERS);
  sh.clear();
  sh.getRange(1, 1, 1, REVIEW_HEADERS.length).setValues([REVIEW_HEADERS]).setFontWeight('bold').setBackground('#eef7ea');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, REVIEW_HEADERS.length).setValues(rows.map(function (r) { return REVIEW_HEADERS.map(function (h) { return r[h] == null ? '' : r[h]; }); }));
    rows.forEach(function (r, i) { if (r['경고']) sh.getRange(i + 2, 1, 1, REVIEW_HEADERS.length).setBackground(/취소/.test(r['경고']) ? '#f1f5f9' : '#fff4e5'); });
  }
  sh.setFrozenRows(1); sh.autoResizeColumns(1, REVIEW_HEADERS.length);
  sh.activate();
  var bad = rows.filter(function (r) { return r['경고'] && !/^취소$/.test(r['경고']); }).length;
  ui.alert(dates.join(', ') + ' — ' + rows.length + '명\n' + (bad ? '⚠️ 확인할 곳 ' + bad + '명 (주황색 줄)' : '경고 없음') + '\n\n장부(엑셀)에서 최종 확인 후 「신한 다건이체 파일 만들기」를 누르면 그때 입금 예정 알림톡이 나가요.');
}
