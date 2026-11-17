/**
 * 카톡·직원 예약도 알림톡 (2026-11-18 대표 결정)
 *
 * 직원은 지금처럼 장부에 적고, 메모 오른쪽 '연락처' 칸에 휴대폰 번호만 더 적는다.
 * 5분 동기화(syncLedgerPending)가 그 줄을 찾아:
 *   ① 예약 시트에 '카톡·직원' 예약으로 등록(예약번호 발급) → 장부 메모 앞에 예약번호
 *   ② 장부의 번호는 010-****-1234 로 가림 (번호 원본은 예약 시트에만 — 장부는 여러 직원이 봄)
 *   ③ 새 예약이면 예약 완료 알림톡 (기능을 켜기 전에 이미 있던 카톡 예약은 예약 완료만 빼고 그다음부터)
 * 그 뒤로는 신청페이지 예약과 똑같이: 당일 안내·준비 완료·기사님 전화/문자·픽업 완료·계량·정산 알림톡.
 * 계좌는 장부·이 기능에 없음 → 이체는 지금처럼 따로 (이체 파일에서는 '카톡 예약 — 따로 이체'로 빠짐).
 */
var KAKAO_KNOWN_SHEET = '카톡기존';   // 기능 켤 때 이미 있던 카톡 예약(예약 완료 알림톡 안 보냄)

/** 장부에 적힌 번호 → 01012345678 | '' (시트가 앞자리 0 을 지운 10자리도 살림, 가린 번호는 '') */
function phoneDigits_(v) {
  var raw = String(v == null ? '' : v);
  if (raw.indexOf('*') >= 0) return '';
  var s = raw.replace(/[^0-9]/g, '');
  if (s.length === 10 && s.charAt(0) === '1') s = '0' + s;
  return /^01\d{8,9}$/.test(s) ? s : '';
}
function maskPhone_(d) { return d.slice(0, 3) + '-****-' + d.slice(-4); }
function kakaoKey_(date, name, addr) { return date + '|' + String(name).trim() + '|' + String(addr).trim(); }

function kakaoKnown_() {
  var sh = ss_().getSheetByName(KAKAO_KNOWN_SHEET), out = {};
  if (sh) sh.getDataRange().getValues().slice(1).forEach(function (r) { out[String(r[0])] = 1; });
  return out;
}

/** 이번 달·다음 달 장부 시트 (중복 없이) */
function kakaoSheets_(today) {
  var R = rules_(), seen = {}, out = [];
  [0, 31].forEach(function (k) {
    var d = R.addDays(today, k), lss = ledgerOpen_(d), sh = lss && ledgerMonthSheet_(lss, d);
    if (!sh) return;
    var key = d.slice(0, 4) + sh.getName();
    if (seen[key]) return; seen[key] = 1;
    out.push({ sh: sh, tz: lss.getSpreadsheetTimeZone() || 'GMT' });
  });
  return out;
}

/** 5분 동기화 때: 장부 '연락처'가 적힌 카톡·직원 줄 → 예약 등록 + 번호 가리기 + (새 예약이면) 예약 완료 알림톡. 반환 등록 수 */
function kakaoIntake_(now) {
  var R = rules_(), today = R.todayKST(now || new Date()), from = R.addDays(today, -1), n = 0, known = null;
  kakaoSheets_(today).forEach(function (x) {
    var sh = x.sh, v = sh.getDataRange().getValues(), LC = ledgerCols_(sh, v);
    if (!LC.phone) return;
    for (var i = 1; i < v.length; i++) {
      var date = cellYmd_(v[i][LEDGER_COL.date - 1], x.tz);
      if (!date || date < from) continue;
      var name = String(v[i][LEDGER_COL.name - 1] || '').trim(), memo = String(v[i][LC.memo - 1] || '');
      if (!name || /ESD-\d{6}-[A-Z0-9]{4}/.test(memo) || /^\[취소/.test(memo)) continue;
      var phone = phoneDigits_(v[i][LC.phone - 1]);
      if (!phone) continue;
      var area = String(v[i][LEDGER_COL.area - 1] || '').trim(), addr = String(v[i][LEDGER_COL.addr - 1] || '').trim();
      var b = bookData_(), ids = {};
      for (var k = 1; k < b.data.length; k++) ids[String(b.data[k][b.col('예약번호')])] = 1;
      var rid; do { rid = R.reservationId(date, rand4_()); } while (ids[rid]);
      var full = driverMapQuery_(area, addr), stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
      var row = { '예약번호': rid, '확정상태': '확정', '장부반영': '완료', '장부반영시각': stamp, '수거일': date, '구역': '', '신청시각': stamp,
        '이름': name, '연락처': phone, '시군구': area, '도로명주소': full, '상세주소': '', '요청사항': memo, '출처': '카톡·직원' };
      b.sh.appendRow(b.hdr.map(function (h) { var y = row[h]; return h === '연락처' ? "'" + y : (y === undefined ? '' : y); }));
      sh.getRange(i + 1, LC.memo).setValue(rid + ' 카톡' + (memo ? ' / ' + memo : ''));
      sh.getRange(i + 1, LC.phone).setNumberFormat('@').setValue(maskPhone_(phone));
      driverCacheClear_(date);
      if (!known) known = kakaoKnown_();
      if (!known[kakaoKey_(date, name, addr)] && date >= today) {
        try { alimBooked_({ name: name, phone: phone, date: date, roadAddress: full, addressDetail: '' }, rid); } catch (e) { logError_('알림톡(카톡 예약 완료)', e); }
      }
      n++;
    }
  });
  return n;
}

/** 한 번만: 이번 달·다음 달 장부 메모 오른쪽에 '연락처' 머리글 + 지금 있는 카톡 예약을 '기존'으로 기록. 반환 [{시트, 칸, 기존}] */
function setupKakaoPhone() {
  var R = rules_(), today = R.todayKST(new Date()), out = [];
  var ks = sheet_(KAKAO_KNOWN_SHEET, ['키', '기록시각']), have = kakaoKnown_(), stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  kakaoSheets_(today).forEach(function (x) {
    var sh = x.sh;
    ledgerColsReset_();
    var v = sh.getDataRange().getValues(), LC = ledgerCols_(sh, v);
    if (!LC.phone) {
      var col = LC.memo + 1;
      if (String((v[0] || [])[col - 1] || '').trim()) return out.push({ sheet: sh.getName(), error: '메모 오른쪽 칸 머리글이 비어 있지 않음' });
      sh.getRange(1, col).setValue('연락처');
      ledgerColsReset_(); LC = ledgerCols_(sh);
    }
    var added = 0;
    for (var i = 1; i < v.length; i++) {
      var date = cellYmd_(v[i][LEDGER_COL.date - 1], x.tz), name = String(v[i][LEDGER_COL.name - 1] || '').trim(), memo = String(v[i][LC.memo - 1] || '');
      if (!date || date < R.addDays(today, -1) || !name || /ESD-\d{6}-[A-Z0-9]{4}/.test(memo)) continue;
      var key = kakaoKey_(date, name, String(v[i][LEDGER_COL.addr - 1] || ''));
      if (have[key]) continue;
      ks.appendRow([key, stamp]); have[key] = 1; added++;
    }
    out.push({ sheet: sh.getName(), col: LC.phone, known: added });
  });
  ledgerColsReset_();
  return out;
}
function menuSetupKakaoPhone_() {
  var r = setupKakaoPhone();
  SpreadsheetApp.getUi().alert(r.map(function (x) { return x.error ? x.sheet + ': ' + x.error : x.sheet + ': 「연락처」 칸 ' + colLetter_(x.col) + '열, 지금 있는 카톡 예약 ' + x.known + '건은 예약 완료 알림톡 없이 등록'; }).join('\n') +
    '\n\n이제 카톡 예약 줄의 연락처 칸에 휴대폰 번호를 적으면 5분 안에 예약번호가 붙고 알림톡이 시작돼요. 번호는 장부에서 가려져요.');
}
