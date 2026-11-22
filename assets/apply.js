/* 이수다 수거 신청 페이지 */
(function () {
  'use strict';
  var R = window.ESUDA_RULES, CFG = window.ESUDA_APPLY || {};
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /\.(localhost|test)$/.test(location.hostname);
  var API = CFG.apiUrl || (isLocal ? '/api' : '');
  var KAKAO = CFG.kakaoUrl || 'https://pf.kakao.com/_DxoHVG/chat';
  var $ = function (id) { return document.getElementById(id); };
  var state = { address: null, cls: null, date: '', amount: '', place: '', entrance: '', schedule: { closures: [], openDates: [], today: R.todayKST() }, sending: false };

  // 같은 제출을 다시 보내도 예약이 하나만 생기도록: 페이지(탭)마다 고정된 제출 ID
  function submissionId() {
    var k = 'esuda_sub_id', v = null;
    try { v = sessionStorage.getItem(k); } catch (e) {}
    if (!v) {
      v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
      try { sessionStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  }

  if (!CFG.apiUrl && isLocal) $('testBadge').hidden = false;
  if (!API) { // 운영 주소인데 서버 미설정 → 신청 막고 카톡 안내
    $('applyForm').innerHTML = '<section class="ap-card"><h2>신청 페이지 준비 중이에요</h2><p class="ap-hint">지금은 카카오채널로 신청해 주세요.</p><a class="ap-submit" style="display:flex;align-items:center;justify-content:center" href="' + KAKAO + '">카카오채널로 신청하기</a></section>';
    return;
  }

  // ---------------- 방문 단계 기록 (2026-11-16: 어디서 그만두는지 보려고 — 이름·연락처 등 개인정보는 안 보냄)
  var TRK = { sid: Math.random().toString(36).slice(2, 10), sent: {}, last: 'open', done: false };
  var DEV = /KAKAOTALK/i.test(navigator.userAgent) ? '카톡' : (/iPhone|iPad|Android/i.test(navigator.userAgent) ? '모바일' : 'PC');
  // 2026-11-21: 대표·직원 휴대폰은 esuda.kr/apply/?staff=1 로 한 번 열면 기억 → 방문 기록에 '직원'으로 표시해 이탈 통계에서 뺌 (?staff=0 이면 해제)
  try { var sq = /[?&]staff=([01])/.exec(location.search); if (sq) { if (sq[1] === '1') localStorage.setItem('esuda_staff', '1'); else localStorage.removeItem('esuda_staff'); } if (localStorage.getItem('esuda_staff') === '1') DEV += '·직원'; } catch (e) {}
  function track(step, info) {
    var key = step + (step === 'invalid' ? ':' + info : '');
    if (TRK.sent[key] || !API || isLocal) return;
    TRK.sent[key] = 1; if (step !== 'leave') TRK.last = step;
    var body = JSON.stringify({ action: 'track', sid: TRK.sid, step: step, info: String(info || '').slice(0, 80), dev: DEV });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(API, new Blob([body], { type: 'text/plain;charset=utf-8' }))) return;
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && !TRK.done && TRK.last !== 'open') track('leave', TRK.last);
  });

  function api(method, body, query) {
    var url = API + (query ? (API.indexOf('?') >= 0 ? '&' : '?') + query : '');
    var opt = method === 'GET' ? { method: 'GET' } : { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) };
    return fetch(url, opt).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
  }

  // ---------------- 선택 칩
  function chips(group, items, onPick) {
    var box = document.querySelector('[data-group="' + group + '"]');
    items.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ap-chip'; b.textContent = t;
      b.addEventListener('click', function () {
        box.querySelectorAll('.ap-chip').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); state[group] = t; clearErr(group); if (onPick) onPick(t);
      });
      box.appendChild(b);
    });
  }
  chips('amount', R.AMOUNTS, function (t) { $('payOptHint').hidden = t !== R.AMOUNTS[0] || $('noPay').checked; $('amountDetailWrap').hidden = t !== R.AMOUNT_OTHER; });
  // ---------------- 사진 (선택) — 2026-11-16: 최대 2장, 고르는 즉시 뒤에서 미리 올림(신청 버튼 누를 땐 이미 끝나 있게)
  var photos = []; // { data, st: 'up'|'ok'|'fail', id, p }
  chips('photoMode', R.PHOTO_MODES, function (t) {
    $('photoWrap').hidden = t !== R.PHOTO_MODES[0];
    $('photoLaterHint').hidden = t !== R.PHOTO_MODES[1];
  });
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1024 / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('img')); };
      img.src = url;
    });
  }
  function preUpload(ph) {
    var t0 = Date.now();
    var send = function () { return api('POST', { action: 'photoPre', submissionId: submissionId(), data: ph.data.split(',')[1] }); };
    ph.st = 'up';
    ph.p = send().then(function (x) { if (!(x && x.ok)) throw new Error('fail'); return x; })
      .catch(function () { return send().then(function (x) { if (!(x && x.ok)) throw new Error('fail'); return x; }); })
      .then(function (x) { ph.st = 'ok'; ph.id = x.id; track('t_prephoto', '1장 ' + ((Date.now() - t0) / 1000).toFixed(1) + '초'); })
      .catch(function () { ph.st = 'fail'; track('photo_fail', 'pre'); })
      .then(renderPhotos);
    return ph.p;
  }
  function renderPhotos() {
    var box = $('photoList'); box.innerHTML = '';
    photos.forEach(function (ph, i) {
      var w = document.createElement('div');
      var badge = ph.st === 'ok' ? '✓ 올림' : (ph.st === 'fail' ? '실패' : '올리는 중…');
      w.innerHTML = '<img alt=""><span class="ap-ph-st ' + ph.st + '">' + badge + '</span><button type="button" aria-label="사진 빼기">✕</button>';
      w.querySelector('img').src = ph.data;
      w.querySelector('button').addEventListener('click', function () { photos.splice(i, 1); renderPhotos(); });
      box.appendChild(w);
    });
    $('photoAddBtn').hidden = photos.length >= R.PHOTO_MAX;
  }
  $('photoInput').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []).slice(0, R.PHOTO_MAX - photos.length);
    this.value = '';
    files.reduce(function (pr, f) {
      return pr.then(function () { return shrink(f).then(function (d) { var ph = { data: d }; photos.push(ph); preUpload(ph); renderPhotos(); }); });
    }, Promise.resolve())
      .then(function () { clearErr('photo'); track('photo', photos.length + '장'); })
      .catch(function () { renderPhotos(); setErr('photo', '사진을 읽지 못했어요. 다른 사진을 고르거나, "나중에 카톡으로 보낼게요"를 골라 주세요.'); track('photo_read_fail', ''); });
  });
  /** 신청 직전: 아직 올라가는 사진이 있으면 최대 15초 기다림 → 올라간 사진 id 목록 */
  function photosReady() {
    if (state.photoMode !== R.PHOTO_MODES[0] || !photos.length) return Promise.resolve([]);
    var pending = photos.filter(function (ph) { return ph.st === 'up'; });
    if (pending.length) showWait(true, '사진 마무리 중이에요… 잠시만요');
    var all = Promise.all(photos.map(function (ph) { return ph.p; }));
    var limit = new Promise(function (ok) { setTimeout(ok, 15000); });
    return Promise.race([all, limit]).then(function () { return photos.filter(function (ph) { return ph.st === 'ok'; }).map(function (ph) { return ph.id; }); });
  }

  // 계좌 없이 무상수거 체크 → 계좌 칸 숨김 (2026-11-16)
  $('noPay').addEventListener('change', function () {
    $('payFields').hidden = this.checked; ['bank', 'account', 'holder'].forEach(clearErr);
    if (this.checked) track('nopay', '');
  });

  chips('place', R.PLACES, function (t) { $('placeDetailWrap').hidden = t !== '직접 입력'; });
  chips('entrance', R.ENTRANCE, function (t) { $('entranceCodeWrap').hidden = t !== '공동현관 비밀번호'; });
  R.BANKS.forEach(function (b) { var o = document.createElement('option'); o.value = b; o.textContent = b; $('bank').appendChild(o); });

  // 휴대폰 번호 자동 하이픈
  $('phone').addEventListener('input', function () {
    var d = R.digits(this.value).slice(0, 11);
    this.value = d.length > 7 ? d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3') : d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
  });
  $('account').addEventListener('input', function () { this.value = this.value.replace(/[^0-9-]/g, ''); });

  // ---------------- 주소 검색 (카카오 우편번호 서비스, 화면 안에 띄움 — 카톡 인앱 브라우저 대응)
  function openPostcode() {
    if (!window.daum || !daum.Postcode) { setErr('address', '주소 검색을 불러오지 못했어요. 잠시 후 다시 시도하거나 카카오채널로 신청해 주세요.'); return; }
    $('postLayer').hidden = false;
    $('postBox').innerHTML = '';
    new daum.Postcode({
      oncomplete: function (d) {
        $('postLayer').hidden = true;
        pickAddress({ sido: d.sido, sigungu: d.sigungu, bname: d.bname, zonecode: d.zonecode,
          roadAddress: d.roadAddress || d.autoRoadAddress, jibunAddress: d.jibunAddress || d.autoJibunAddress, buildingName: d.buildingName });
      },
      width: '100%', height: '100%'
    }).embed($('postBox'));
  }
  $('btnAddr').addEventListener('click', openPostcode);
  $('btnPostClose').addEventListener('click', function () { $('postLayer').hidden = true; });

  function pickAddress(a) {
    state.address = a; clearErr('address');
    $('addrView').hidden = false;
    $('addrRoad').textContent = a.roadAddress + (a.buildingName ? ' (' + a.buildingName + ')' : '');
    $('addrJibun').textContent = a.jibunAddress ? '지번 ' + a.jibunAddress : '';
    $('btnAddr').textContent = '주소 다시 검색';
    var c = R.classifyAddress(a); state.cls = c;
    track('addr', c.ok ? 'ok' : (c.reason + ' ' + (a.sido || '') + ' ' + (a.sigungu || '')));
    var z = $('zoneMsg'); z.hidden = false;
    if (c.ok) {
      z.className = 'ap-zone ok';
      z.textContent = '수거 가능한 지역이에요. ' + (c.parity === 'odd' ? '홀수 날짜' : '짝수 날짜') + '에 방문해요.';
      $('detailWrap').hidden = false;
    } else {
      z.className = 'ap-zone no';
      z.innerHTML = (c.reason === 'check' ? '이 주소는 수거 가능 여부를 확인해야 해요.' : '아직 신청 페이지로 받지 않는 지역이에요.') +
        ' <a href="' + KAKAO + '" target="_blank" rel="noopener">카카오채널로 신청·문의하기</a>';
      $('detailWrap').hidden = true;
    }
    state.date = '';
    renderDates();
  }

  if (isLocal) window.__applyTest = { pickAddress: function (a) { pickAddress(a); } }; // 로컬 미리보기 시험용(운영 주소에선 없음)

  // ---------------- 날짜
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  function renderDates() {
    var box = $('dateList'); box.innerHTML = '';
    var hint = $('dateHint'), note = $('closeNotice');
    note.hidden = true;
    if (!state.cls || !state.cls.ok) { hint.hidden = false; hint.textContent = state.cls ? '이 주소는 카카오채널로 신청해 주세요.' : '주소를 먼저 선택해 주세요.'; return; }
    var sc = state.schedule;
    var cal = R.calendar(state.cls.zone, { today: sc.today, now: new Date(), closures: sc.closures, openDates: sc.openDates, counts: sc.counts });
    var msgs = {};
    cal.forEach(function (d) { if (d.reason === 'closed' && d.message) msgs[d.message] = 1; });
    var m = Object.keys(msgs);
    if (m.length) { note.hidden = false; note.textContent = m.join(' / '); }
    var open = cal.filter(function (d) { return d.open; });
    if (!open.length) { hint.hidden = false; hint.textContent = '지금은 예약 가능한 날짜가 없어요. 카카오채널로 문의해 주세요.'; track('nodate', state.cls.zone); return; }
    hint.hidden = true;
    // 2026-11-16: 달력(한 달씩) — 가능한 날만 초록으로 눌림
    var byDate = {}; cal.forEach(function (d) { byDate[d.date] = d; });
    var months = []; cal.forEach(function (d) { var m = d.date.slice(0, 7); if (months.indexOf(m) < 0) months.push(m); });
    var firstOpenM = open[0].date.slice(0, 7), lastOpenM = open[open.length - 1].date.slice(0, 7);
    var mon = state.calMonth || (state.date ? state.date.slice(0, 7) : firstOpenM);
    if (mon < firstOpenM) mon = firstOpenM; if (mon > lastOpenM) mon = lastOpenM;
    state.calMonth = mon;
    var y = +mon.slice(0, 4), mo = +mon.slice(5, 7);
    var head = document.createElement('div'); head.className = 'ap-cal-head';
    var prev = document.createElement('button'), next = document.createElement('button');
    prev.type = next.type = 'button'; prev.className = next.className = 'ap-cal-nav';
    prev.innerHTML = '&#9664;'; next.innerHTML = '&#9654;'; prev.setAttribute('aria-label', '이전 달'); next.setAttribute('aria-label', '다음 달');
    prev.disabled = mon <= firstOpenM; next.disabled = mon >= lastOpenM;
    var shift = function (k) { var t = new Date(Date.UTC(y, mo - 1 + k, 1)); state.calMonth = t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2); renderDates(); track('calmonth', state.calMonth); };
    prev.addEventListener('click', function () { shift(-1); }); next.addEventListener('click', function () { shift(1); });
    var title = document.createElement('b'); title.textContent = y + '년 ' + mo + '월';
    head.appendChild(prev); head.appendChild(title); head.appendChild(next); box.appendChild(head);
    var grid = document.createElement('div'); grid.className = 'ap-cal';
    WD.forEach(function (w, i) { var h = document.createElement('span'); h.className = 'ap-cal-wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''); h.textContent = w; grid.appendChild(h); });
    var lead = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    for (var i = 0; i < lead; i++) grid.appendChild(document.createElement('span'));
    for (var dd = 1; dd <= last; dd++) (function (dd) {
      var ds = mon + '-' + ('0' + dd).slice(-2), info = byDate[ds];
      var c = document.createElement('button'); c.type = 'button';
      var tag = '';
      if (ds === sc.today && info && info.open) tag = '오늘';
      else if (info && info.reason === 'full') tag = '마감';
      else if (info && info.reason === 'closed') tag = '휴무';
      c.className = 'ap-day' + (info && info.open ? ' ok' : '') + (state.date === ds ? ' on' : '') + (ds === sc.today ? ' today' : '');
      c.innerHTML = '<b>' + dd + '</b>' + (tag ? '<small>' + tag + '</small>' : '');
      if (info && info.open) c.addEventListener('click', function () { state.date = ds; clearErr('date'); renderDates(); track('date', ds === sc.today ? '오늘' : ''); });
      else c.disabled = true;
      grid.appendChild(c);
    })(dd);
    box.appendChild(grid);
    var pick = document.createElement('p'); pick.className = 'ap-cal-pick';
    if (state.date) { var sd = R.parseYmd(state.date); pick.innerHTML = '선택: <b>' + (sd.getUTCMonth() + 1) + '월 ' + sd.getUTCDate() + '일 (' + WD[sd.getUTCDay()] + ')</b>' + (state.date === sc.today ? ' · 오늘 오후 5시 마감' : ''); }
    else { pick.className += ' none'; pick.textContent = '초록색 날짜 중 하나를 눌러 주세요.'; }
    box.appendChild(pick);
  }

  function loadSchedule() {
    return api('GET', null, 'action=schedule').then(function (r) {
      if (r && r.ok) state.schedule = { closures: r.closures || [], openDates: r.openDates || [], counts: r.counts || {}, today: r.today || R.todayKST() };
      renderDates();
    }).catch(function () { renderDates(); });
  }
  loadSchedule();
  track('open', document.referrer ? (document.referrer.split('/')[2] || '') : '');

  // ---------------- 오류 표시
  function setErr(f, msg) { var el = document.querySelector('[data-err="' + f + '"]'); if (el) el.textContent = msg || ''; }
  function clearErr(f) { setErr(f, ''); }
  function clearAll() { document.querySelectorAll('[data-err]').forEach(function (e) { e.textContent = ''; }); $('formError').textContent = ''; }
  var ERR_NAME = { address: '주소', addressDetail: '상세주소', date: '수거 날짜', amount: '수거 양', amountDetail: '수거 양', place: '물건 놓을 곳', placeDetail: '물건 놓을 곳',
    entrance: '공동현관 출입 방법', entranceCode: '공동현관 비밀번호', name: '이름', phone: '휴대폰 번호', bank: '은행', account: '계좌번호', holder: '예금주',
    agreeNotice: '이용 안내 확인', agreePrivacy: '개인정보 동의', photo: '사진' };
  // 고친 칸은 바로 빨간 표시 지움
  document.addEventListener('input', function (e) { var s = e.target.closest && e.target.closest('.ap-bad'); if (s) s.classList.remove('ap-bad'); }, true);
  document.addEventListener('click', function (e) { var s = e.target.closest && e.target.closest('.ap-bad'); if (s && e.target.closest('.ap-chips, .ap-check, button')) s.classList.remove('ap-bad'); }, true);
  // 2026-11-22: '모두 동의' 한 번에 (개별 체크는 그대로 — 둘 다 체크돼야 신청)
  (function () {
    var all = $('agreeAll'), a = $('agreeNotice'), b = $('agreePrivacy');
    if (!all) return;
    all.addEventListener('change', function () { a.checked = b.checked = all.checked; if (all.checked) { clearErr('agreeNotice'); clearErr('agreePrivacy'); } });
    [a, b].forEach(function (x) { x.addEventListener('change', function () { all.checked = a.checked && b.checked; }); });
  })();
  function showErrors(errs) {
    var first = null;
    Object.keys(errs).forEach(function (k) {
      setErr(k, errs[k]);
      var el = document.querySelector('[data-err="' + k + '"]');
      if (el && !first) first = el;
    });
    // 2026-11-22: 무엇을 고쳐야 하는지 한 줄로 + 그 칸(섹션)을 빨간 테두리로, 화면은 첫 칸으로
    var names = Object.keys(errs).map(function (k) { return ERR_NAME[k] || ''; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    $('formError').textContent = names.length ? '확인할 곳 ' + names.length + '개: ' + names.slice(0, 4).join(', ') + (names.length > 4 ? ' 외 ' + (names.length - 4) + '곳' : '') + ' — 빨간 테두리를 확인해 주세요.' : '빨간 글씨로 표시된 곳을 확인해 주세요.';
    document.querySelectorAll('.ap-bad').forEach(function (s) { s.classList.remove('ap-bad'); });
    Object.keys(errs).forEach(function (k) { var el = document.querySelector('[data-err="' + k + '"]'), sec = el && (el.closest('section') || el.parentNode); if (sec) sec.classList.add('ap-bad'); });
    var target = null;   // 화면에서 가장 위에 있는 틀린 칸으로
    document.querySelectorAll('.ap-bad').forEach(function (x) { if (!target || x.getBoundingClientRect().top < target.getBoundingClientRect().top) target = x; });
    target = target || (first && (first.closest('section') || first));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function payload() {
    return {
      action: 'submit', submissionId: submissionId(),
      name: $('name').value, phone: $('phone').value, address: state.address || {}, addressDetail: $('addrDetail').value,
      date: state.date, amount: state.amount, amountDetail: $('amountDetail').value, photoMode: state.photoMode || '', place: state.place, placeDetail: $('placeDetail').value,
      entrance: state.entrance, entranceCode: $('entranceCode').value, memo: $('memo').value,
      bank: $('noPay').checked ? '' : $('bank').value, account: $('noPay').checked ? '' : $('account').value, holder: $('noPay').checked ? '' : $('holder').value,
      noPay: $('noPay').checked,
      agreeNotice: $('agreeNotice').checked, agreePrivacy: $('agreePrivacy').checked
    };
  }

  // 신청 중 안내 (2026-11-16 대표 요청: 모바일에서 확정까지 몇 초 걸려 '잠시만 기다려 주세요' 표시)
  var waitBox = null;
  function showWait(on, msg) {
    if (!waitBox) {
      waitBox = document.createElement('div'); waitBox.className = 'ap-wait'; waitBox.setAttribute('role', 'status'); waitBox.setAttribute('aria-live', 'polite');
      waitBox.innerHTML = '<div class="ap-wait-box"><div class="ap-spin"></div><b id="waitMsg"></b><small>몇 초 걸릴 수 있어요. 창을 닫거나 버튼을 다시 누르지 마세요.</small></div>';
      document.body.appendChild(waitBox);
    }
    waitBox.hidden = !on; if (msg) $('waitMsg').textContent = msg;
  }

  // ---------------- 신청 (2026-11-16: 확정 화면을 먼저 보여 주고 저장은 뒤에서 — 창을 닫아도 끝까지 전송)
  // 2026-11-17: 예약번호 끝 4자리는 숫자만 (고객이 부르기 쉽게)
  function rand4() { var a = '0123456789', s = ''; for (var i = 0; i < 4; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return s; }
  function saveBooking(p) {
    var attempt = function (n) {
      return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p), keepalive: true })
        .then(function (x) { if (!x.ok) throw new Error('http ' + x.status); return x.json(); })
        .then(function (r) { if (r && !r.ok && r.error === 'busy' && n < 3) throw new Error('busy'); return r; })
        .catch(function (e) {
          if (n >= 3) throw e;
          return new Promise(function (ok) { setTimeout(ok, 1500 * (n + 1)); }).then(function () { return attempt(n + 1); });
        });
    };
    return attempt(0);
  }
  function setSave(cls, html) { var el = $('doneSave'); el.hidden = false; el.className = 'ap-save ' + cls; el.innerHTML = html; }

  $('applyForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (state.sending) return;
    clearAll();
    var p = payload();
    var v = R.validateApplication(p, { today: state.schedule.today, now: new Date(), closures: state.schedule.closures, openDates: state.schedule.openDates, counts: state.schedule.counts });
    if (!v.ok) { showErrors(v.errors); track('invalid', Object.keys(v.errors).sort().join(',')); return; }
    track('submit', state.photoMode === R.PHOTO_MODES[0] ? '사진 ' + photos.length + '장' : '');
    state.sending = true; $('btnSubmit').disabled = true; $('btnSubmit').textContent = '신청 저장 중…';
    var tStart = Date.now(), want = state.photoMode === R.PHOTO_MODES[0] ? photos.length : 0;
    photosReady().then(function (ids) {
      p.photoIds = ids;
      p.reservationIdHint = R.reservationId(p.date, rand4());
      // 1) 확정 화면 즉시
      showDone({ reservationId: p.reservationIdHint, date: p.date }, want ? { total: want, sent: ids.length, pending: true } : null);
      setSave('wait', '⏳ 예약을 저장하고 있어요… <small>(이 창을 닫아도 저장돼요)</small>');
      var tShown = Date.now();
      track('t_shown', '사진' + ids.length + '장 ' + ((tShown - tStart) / 1000).toFixed(1) + '초');
      // 2) 저장은 뒤에서
      return saveBooking(p).then(function (r) {
        if (r && r.ok) {
          TRK.done = true; track('done', r.reservationId);
          if (r.reservationId !== p.reservationIdHint) $('doneId').textContent = R.shortId(r.reservationId);
          setSave('ok', '✓ 예약이 저장됐어요');
          if (want) showPhotoLine(r.reservationId, r.photos || 0, want);
          track('t_confirm', '사진' + ids.length + '장 ' + ((Date.now() - tStart) / 1000).toFixed(1) + '초 (화면 ' + ((tShown - tStart) / 1000).toFixed(1) + '초, 서버 ' + ((r.srv && r.srv.total) / 1000 || 0).toFixed(1) + '초)');
          try { sessionStorage.removeItem('esuda_sub_id'); } catch (e) {}
          return;
        }
        if (r && r.error === 'invalid' && r.errors) { // 드묾: 그사이 그날이 마감 등 → 신청 화면으로 돌아가 안내
          $('doneView').hidden = true; $('formView').hidden = false;
          if (r.errors.date) { state.date = ''; loadSchedule(); }
          showErrors(r.errors);
          $('formError').textContent = '방금 확인해 보니 신청을 마칠 수 없었어요. 빨간 글씨를 확인해 주세요.';
          track('invalid', 'server:' + Object.keys(r.errors).sort().join(','));
          return;
        }
        throw new Error(r && r.error || 'fail');
      });
    }).catch(function (e) {
      track('fail', String(e && e.message || 'network'));
      setSave('bad', '⚠️ 저장이 아직 확인되지 않았어요. <button type="button" id="btnRetrySave" class="ap-retry">다시 시도</button><br><small>계속 안 되면 카카오채널로 예약번호와 함께 알려 주세요.</small>');
      var rb = $('btnRetrySave');
      if (rb) rb.addEventListener('click', function () {
        setSave('wait', '⏳ 다시 저장하는 중…');
        saveBooking(p).then(function (r) {
          if (r && r.ok) { TRK.done = true; track('done', r.reservationId); $('doneId').textContent = R.shortId(r.reservationId); setSave('ok', '✓ 예약이 저장됐어요'); if (want) showPhotoLine(r.reservationId, r.photos || 0, want); }
          else setSave('bad', '⚠️ 저장하지 못했어요. 카카오채널로 예약번호와 함께 알려 주세요.');
        }).catch(function () { setSave('bad', '⚠️ 인터넷 연결을 확인하고 다시 시도해 주세요.'); });
      });
    }).then(function () {
      state.sending = false; $('btnSubmit').disabled = false; $('btnSubmit').textContent = '수거 신청하기';
      showWait(false);
    });
  });

  function showPhotoLine(rid, sent, total) {
    var dp = $('donePhoto'); dp.hidden = false;
    if (sent >= total) { dp.textContent = '✅ 사진 ' + sent + '장이 함께 접수됐어요.'; return; }
    track('photo_fail', sent + '/' + total);
    dp.textContent = (sent ? '사진 ' + sent + '장만 접수됐어요. ' : '사진을 올리지 못했어요. ') + '카카오채널로 예약번호(' + rid + ')와 함께 옷 사진을 보내 주세요.';
    $('doneKakao').textContent = '카카오채널로 사진 보내기'; $('doneKakao').className = 'ap-submit'; $('doneKakao').style.display = 'flex';
    $('doneKakao').style.alignItems = 'center'; $('doneKakao').style.justifyContent = 'center';
  }

  function showDone(r, up) {
    var dt = R.parseYmd(r.date);
    $('doneId').textContent = R.shortId(r.reservationId);
    $('doneDate').textContent = (dt.getUTCMonth() + 1) + '월 ' + dt.getUTCDate() + '일 (' + WD[dt.getUTCDay()] + ')';
    $('doneAddr').textContent = (state.address ? state.address.roadAddress : '') + ' ' + $('addrDetail').value;
    var later = !(up && up.pending) && (state.photoMode === R.PHOTO_MODES[1] || (up && up.sent < up.total) || (state.photoMode === R.PHOTO_MODES[0] && !photos.length));
    var dp = $('donePhoto');
    if (up && up.pending) { dp.hidden = false; dp.textContent = '📷 사진 ' + up.sent + '장을 함께 접수하는 중이에요.'; }
    if (later) {
      dp.hidden = false;
      dp.textContent = (up && up.sent < up.total ? '사진 일부를 올리지 못했어요. ' : '') + '카카오채널로 예약번호(' + R.shortId(r.reservationId) + ')와 함께 옷 사진을 보내 주세요.';
      $('doneKakao').textContent = '카카오채널로 사진 보내기'; $('doneKakao').className = 'ap-submit'; $('doneKakao').style.display = 'flex';
      $('doneKakao').style.alignItems = 'center'; $('doneKakao').style.justifyContent = 'center';
    }
    $('formView').hidden = true; $('doneView').hidden = false;
    window.scrollTo(0, 0);
  }
})();
