/*
 * 이수다 수거 예약 규칙 (신청 페이지와 서버가 같이 쓰는 파일)
 * - 브라우저: window.ESUDA_RULES
 * - Google Apps Script: 같은 내용을 server/apps-script/Rules.gs 로 복사해서 사용 (tools/sync_rules.py)
 * - Node 테스트: require('../assets/apply-rules.js')
 * 고객 정보·비밀 키는 이 파일에 넣지 않는다 (공개 저장소).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ESUDA_RULES = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 설정 (운영 담당자 확인 후 조정)
  var CONFIG = {
    version: '2026-11-16c',
    minLeadDays: 0,          // 2026-11-15 대표 결정: 당일 예약 받음
    sameDayCutoffHour: 17,   // 당일 예약은 오후 5시(한국 시간) 전까지 — 보통 5시쯤 전체 예약 마감
    dailyCap: 22,            // 하루 최대 예약 수(20~22개). 차면 자동 마감. 급한 고객·양 많은 고객은 직원이 따로 추가
    horizonDays: 30,         // 2026-11-16 대표 결정: 예약은 오늘부터 30일까지
    closedWeekdays: [0, 6]   // 0=일, 6=토 — 주말 기본 마감 (대표 예외는 openDates 로)
  };

  // 한강 기준: south = 홀수일, north = 짝수일
  var PARITY = { south: 'odd', north: 'even' };

  // 주소 분류표. key = 시도|시군구 (카카오 우편번호 서비스의 sido, sigungu 값)
  // status: ok = 바로 예약, check = 운영 담당자 확인 전 → 카톡 안내
  var ZONES = {
    // 서울 한강 남쪽 11개 구 → 홀수일
    '서울|강서구': { zone: 'south', status: 'ok' }, '서울|양천구': { zone: 'south', status: 'ok' },
    '서울|구로구': { zone: 'south', status: 'ok' }, '서울|금천구': { zone: 'south', status: 'ok' },
    '서울|영등포구': { zone: 'south', status: 'ok' }, '서울|동작구': { zone: 'south', status: 'ok' },
    '서울|관악구': { zone: 'south', status: 'ok' }, '서울|서초구': { zone: 'south', status: 'ok' },
    '서울|강남구': { zone: 'south', status: 'ok' }, '서울|송파구': { zone: 'south', status: 'ok' },
    '서울|강동구': { zone: 'south', status: 'ok' },
    // 서울 한강 북쪽 14개 구 → 짝수일
    '서울|은평구': { zone: 'north', status: 'ok' }, '서울|마포구': { zone: 'north', status: 'ok' },
    '서울|서대문구': { zone: 'north', status: 'ok' }, '서울|종로구': { zone: 'north', status: 'ok' },
    '서울|중구': { zone: 'north', status: 'ok' }, '서울|용산구': { zone: 'north', status: 'ok' },
    '서울|성동구': { zone: 'north', status: 'ok' }, '서울|광진구': { zone: 'north', status: 'ok' },
    '서울|동대문구': { zone: 'north', status: 'ok' }, '서울|성북구': { zone: 'north', status: 'ok' },
    '서울|강북구': { zone: 'north', status: 'ok' }, '서울|도봉구': { zone: 'north', status: 'ok' },
    '서울|노원구': { zone: 'north', status: 'ok' }, '서울|중랑구': { zone: 'north', status: 'ok' },
    // 경기 (기존 운영 사례: 김포 홀수, 일산 짝수)
    '경기|김포시': { zone: 'south', status: 'ok' },
    '경기|고양시 일산동구': { zone: 'north', status: 'ok' },
    '경기|고양시 일산서구': { zone: 'north', status: 'ok' },
    '경기|고양시 덕양구': { zone: 'north', status: 'ok' }   // 2026-11-14 대표 확정: 짝수일
  };

  // 동(법정동) 단위 예외: key = 시도|시군구|법정동  (예: 경계 지역). 비어 있으면 구 단위 규칙만 적용
  var EXCEPTIONS = {};

  function normSido(s) {
    s = String(s || '').trim();
    if (/^서울/.test(s)) return '서울';
    if (/^경기/.test(s)) return '경기';
    if (/^인천/.test(s)) return '인천';
    return s;
  }

  /**
   * 주소 분류. addr = 카카오 우편번호 결과의 {sido, sigungu, bname} (또는 같은 이름의 필드)
   * 반환: {ok, zone, parity, key, reason}
   */
  function classifyAddress(addr, zones, exceptions) {
    zones = zones || ZONES; exceptions = exceptions || EXCEPTIONS;
    var sido = normSido(addr && addr.sido);
    var sigungu = String((addr && addr.sigungu) || '').trim().replace(/\s+/g, ' ');
    var bname = String((addr && addr.bname) || '').trim();
    var key = sido + '|' + sigungu;
    var hit = exceptions[key + '|' + bname] || zones[key];
    if (!hit) return { ok: false, zone: null, parity: null, key: key, reason: 'outside' };
    if (hit.status !== 'ok') return { ok: false, zone: hit.zone, parity: PARITY[hit.zone] || null, key: key, reason: 'check' };
    return { ok: true, zone: hit.zone, parity: PARITY[hit.zone], key: key, reason: 'ok' };
  }

  // ---------------------------------------------------------------- 날짜 (한국 시간 기준 'YYYY-MM-DD' 문자열로만 계산)
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return ymd(d) === s ? d : null; // 2026-02-30 같은 잘못된 날짜 거부
  }
  function addDays(s, n) { var d = parseYmd(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  /** 지금 시각 → 한국 날짜 'YYYY-MM-DD' */
  function todayKST(now) {
    var t = (now ? now.getTime() : Date.now()) + 9 * 3600 * 1000;
    return ymd(new Date(t));
  }
  /** 지금 시각 → 한국 시간 '시'(0~23) */
  function hourKST(now) {
    return new Date((now ? now.getTime() : Date.now()) + 9 * 3600 * 1000).getUTCHours();
  }

  /**
   * 마감 목록: [{start:'YYYY-MM-DD', end:'YYYY-MM-DD'?, zone:'all'|'south'|'north'?, message?}]
   * 반환: 그 날짜·구역을 막는 마감 항목 또는 null
   */
  function closureFor(dateStr, zone, closures) {
    closures = closures || [];
    for (var i = 0; i < closures.length; i++) {
      var c = closures[i] || {};
      var s = c.start, e = c.end || c.start;
      if (!parseYmd(s) || !parseYmd(e)) continue;
      var z = c.zone || 'all';
      if (z !== 'all' && z !== zone) continue;
      if (dateStr >= s && dateStr <= e) return c;
    }
    return null;
  }

  /**
   * 하루 판정. opts = {today, now(Date), closures, openDates, counts:{'YYYY-MM-DD':예약수}, config}
   * 반환: {open:boolean, reason:'ok'|'invalid'|'past'|'lead'|'cutoff'|'horizon'|'parity'|'weekend'|'closed'|'full', message?}
   */
  function checkDate(dateStr, zone, opts) {
    opts = opts || {};
    var cfg = opts.config || CONFIG;
    var d = parseYmd(dateStr);
    if (!d || !PARITY[zone]) return { open: false, reason: 'invalid' };
    var today = opts.today || todayKST(opts.now);
    if (dateStr < addDays(today, cfg.minLeadDays)) return { open: false, reason: dateStr < today ? 'past' : 'lead' };
    if (dateStr === today && cfg.sameDayCutoffHour != null && hourKST(opts.now) >= cfg.sameDayCutoffHour) return { open: false, reason: 'cutoff' };
    if (dateStr > addDays(today, cfg.horizonDays)) return { open: false, reason: 'horizon' };
    var day = d.getUTCDate();
    var want = PARITY[zone];
    if ((day % 2 === 1 ? 'odd' : 'even') !== want) return { open: false, reason: 'parity' };
    var c = closureFor(dateStr, zone, opts.closures);
    if (c) return { open: false, reason: 'closed', message: c.message || '' };
    var openDates = opts.openDates || [];
    if (cfg.closedWeekdays.indexOf(d.getUTCDay()) >= 0 && openDates.indexOf(dateStr) < 0) return { open: false, reason: 'weekend' };
    var n = (opts.counts && +opts.counts[dateStr]) || 0;
    if (cfg.dailyCap && n >= cfg.dailyCap) return { open: false, reason: 'full' };
    return { open: true, reason: 'ok' };
  }

  /** 달력용: today+minLead ~ today+horizon 의 각 날짜 판정 */
  function calendar(zone, opts) {
    opts = opts || {};
    var cfg = opts.config || CONFIG;
    var today = opts.today || todayKST(opts.now);
    var out = [];
    for (var i = cfg.minLeadDays; i <= cfg.horizonDays; i++) {
      var s = addDays(today, i);
      var r = checkDate(s, zone, opts);
      out.push({ date: s, open: r.open, reason: r.reason, message: r.message || '' });
    }
    return out;
  }

  // ---------------------------------------------------------------- 신청 내용 검사 (서버에서 다시 실행)
  var BANKS = ['신한은행', 'KB국민은행', '우리은행', '하나은행', 'NH농협은행', 'IBK기업은행', '카카오뱅크', '토스뱅크',
               '새마을금고', '우체국', 'SC제일은행', '부산은행', '대구은행', '경남은행', '광주은행', '전북은행',
               '수협은행', '신협', '케이뱅크', '씨티은행', '산림조합', '저축은행',
               // 2026-11-15 추가: 증권사 계좌로 받는 고객
               '키움증권', '미래에셋증권', '삼성증권', 'NH투자증권', '한국투자증권', 'KB증권', '신한투자증권',
               '토스증권', '카카오페이증권', '대신증권', '하나증권', '메리츠증권'];
  // 2026-11-15 대표 결정: 15kg 기준 두 가지 + 기타(직접 입력)
  var AMOUNTS = ['15kg 미만 (무상수거)', '15kg 이상', '기타 (직접 입력)'];
  var AMOUNT_OTHER = '기타 (직접 입력)';
  var PLACES = ['문 앞에 놓아둘게요', '직접 입력'];
  var ENTRANCE = ['공동현관 비밀번호', '자유 출입 가능', '경비실 호출'];
  // 2026-11-15: 수거 품목 사진 (선택) — 지금 올리기 / 나중에 카톡 / 사진 없음
  var PHOTO_MODES = ['지금 올릴게요', '나중에 카톡으로 보낼게요', '사진 없이 신청할게요'];
  var PHOTO_MAX = 2; // 2026-11-16 대표 결정: 1~2장이면 충분

  function digits(s) { return String(s || '').replace(/[^0-9]/g, ''); }

  /**
   * p = 신청 내용. 반환 {ok, errors:{field:msg}, clean}
   */
  function validateApplication(p, opts) {
    p = p || {}; opts = opts || {};
    var e = {};
    var name = String(p.name || '').trim();
    if (name.length < 2 || name.length > 20) e.name = '이름을 2~20자로 입력해 주세요.';
    var phone = digits(p.phone);
    if (!/^01[016789]\d{7,8}$/.test(phone)) e.phone = '휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)';
    var addr = p.address || {};
    var cls = classifyAddress(addr, opts.zones, opts.exceptions);
    if (!addr.roadAddress && !addr.jibunAddress) e.address = '주소 검색으로 주소를 선택해 주세요.';
    else if (!cls.ok) e.address = cls.reason === 'check' ? '이 주소는 수거 가능 여부를 확인해야 해요. 카카오채널로 신청해 주세요.' : '아직 신청 페이지로 받지 않는 지역이에요. 카카오채널로 문의해 주세요.';
    var detail = String(p.addressDetail || '').trim();
    if (detail.length < 1 || detail.length > 60) e.addressDetail = '동·호수 등 상세주소를 입력해 주세요. (단독주택은 "단독"이라고 적어 주세요)';
    if (cls.ok) {
      var dr = checkDate(p.date, cls.zone, opts);
      if (!dr.open) e.date = dr.reason === 'closed' ? ('선택한 날짜는 예약이 마감됐어요. ' + (dr.message || '다른 날짜를 골라 주세요.'))
        : dr.reason === 'full' ? '선택한 날짜는 예약이 다 찼어요. 다른 날짜를 골라 주세요. (급하시면 카카오채널로 문의해 주세요)'
        : dr.reason === 'cutoff' ? '오늘 수거 신청은 오후 5시에 마감됐어요. 다른 날짜를 골라 주세요.'
        : '선택할 수 없는 날짜예요. 다른 날짜를 골라 주세요.';
    }
    var amountDetail = String(p.amountDetail || '').trim().slice(0, 100);
    if (AMOUNTS.indexOf(p.amount) < 0) e.amount = '수거 양을 골라 주세요.';
    else if (p.amount === AMOUNT_OTHER && !amountDetail) e.amountDetail = '수거 양이나 물품을 적어 주세요. (예: 큰 이불가방 2개, 신발 10켤레)';
    if (PLACES.indexOf(p.place) < 0) e.place = '물건 놓을 곳을 골라 주세요.';
    if (p.place === '직접 입력' && !String(p.placeDetail || '').trim()) e.placeDetail = '물건 놓을 곳을 적어 주세요.';
    if (ENTRANCE.indexOf(p.entrance) < 0) e.entrance = '공동현관 출입 방법을 골라 주세요.';
    var photoMode = PHOTO_MODES.indexOf(p.photoMode) >= 0 ? p.photoMode : '사진 없이 신청할게요';
    // 2026-11-16 대표 결정: 계좌는 필수 아님 — '계좌 없이 무상으로 수거해 주세요' 체크, 또는 15kg 미만 선택 시 비워도 됨
    var acct = digits(p.account), holder = String(p.holder || '').trim();
    var noPay = p.noPay === true;
    var emptyPay = !p.bank && !acct && !holder;
    var payOptional = noPay || (emptyPay && p.amount === AMOUNTS[0]);
    if (noPay || (payOptional && emptyPay)) { acct = ''; holder = ''; }
    else {
      if (BANKS.indexOf(p.bank) < 0) e.bank = emptyPay ? '계좌를 넣거나, 위의 "계좌 없이 무상으로 수거해 주세요"를 체크해 주세요.' : '은행을 골라 주세요.';
      // 2026-11-15 대표 요청: 평생계좌 등 짧은 번호도 받도록 6~20자리로 넓힘 (잘못된 번호는 이체 때 예금주 조회로 걸러짐)
      if (acct.length < 6 || acct.length > 20) e.account = '계좌번호를 숫자만 6~20자리로 입력해 주세요.';
      if (holder.length < 2 || holder.length > 20) e.holder = '예금주를 입력해 주세요.';
    }
    if (p.agreeNotice !== true) e.agreeNotice = '유의사항 확인에 체크해 주세요.';
    if (p.agreePrivacy !== true) e.agreePrivacy = '개인정보 수집·이용에 동의해 주세요.';
    if (!/^[A-Za-z0-9-]{8,64}$/.test(String(p.submissionId || ''))) e.submissionId = '잘못된 요청이에요. 페이지를 새로고침해 주세요.';
    var ok = Object.keys(e).length === 0;
    return {
      ok: ok, errors: e,
      clean: ok ? {
        submissionId: p.submissionId, name: name, phone: phone, date: p.date, zone: cls.zone,
        sido: String(addr.sido || ''), sigungu: String(addr.sigungu || ''), bname: String(addr.bname || ''),
        zonecode: String(addr.zonecode || ''), roadAddress: String(addr.roadAddress || ''), jibunAddress: String(addr.jibunAddress || ''),
        addressDetail: detail, amount: p.amount === AMOUNT_OTHER ? ('기타: ' + amountDetail) : p.amount, place: p.place, placeDetail: String(p.placeDetail || '').trim().slice(0, 100),
        entrance: p.entrance, entranceCode: String(p.entranceCode || '').trim().slice(0, 40),
        memo: String(p.memo || '').trim().slice(0, 300), photoIds: (Array.isArray(p.photoIds) ? p.photoIds : []).slice(0, PHOTO_MAX).map(String), bank: acct ? p.bank : '', account: acct, holder: holder, photoMode: photoMode,
        noPay: noPay, payNote: noPay ? '무상 희망(계좌 없음)' : (acct ? '' : '계좌 없음')
      } : null
    };
  }

  /** 예약번호: ESD-YYMMDD-XXXX (수거일 + 4자리). 2026-11-17부터 새 예약의 4자리는 숫자만 */
  function reservationId(dateStr, rand4) {
    return 'ESD-' + dateStr.slice(2).replace(/-/g, '') + '-' + rand4;
  }
  /** 고객에게 보여 주는 짧은 번호: ESD-261118-4829 → 1118-4829 (안쪽 번호는 그대로) */
  function shortId(rid) {
    var m = /^ESD-\d{2}(\d{4})-([A-Z0-9]{4})$/.exec(String(rid || '').toUpperCase().trim());
    return m ? m[1] + '-' + m[2] : String(rid || '');
  }

  return {
    CONFIG: CONFIG, PARITY: PARITY, ZONES: ZONES, EXCEPTIONS: EXCEPTIONS,
    BANKS: BANKS, AMOUNTS: AMOUNTS, AMOUNT_OTHER: AMOUNT_OTHER, PLACES: PLACES, ENTRANCE: ENTRANCE, PHOTO_MODES: PHOTO_MODES, PHOTO_MAX: PHOTO_MAX,
    classifyAddress: classifyAddress, checkDate: checkDate, calendar: calendar, closureFor: closureFor,
    validateApplication: validateApplication, reservationId: reservationId, shortId: shortId,
    todayKST: todayKST, hourKST: hourKST, addDays: addDays, parseYmd: parseYmd, digits: digits
  };
});
