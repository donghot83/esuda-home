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
    open.forEach(function (d) {
      var dt = R.parseYmd(d.date);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ap-date' + (state.date === d.date ? ' on' : '');
      b.innerHTML = '<b>' + (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate() + '</b><small>' + (d.date === sc.today ? '오늘 (5시 마감)' : WD[dt.getUTCDay()] + '요일') + '</small>';
      b.addEventListener('click', function () { state.date = d.date; clearErr('date'); renderDates(); track('date', d.date === sc.today ? '오늘' : ''); });
      box.appendChild(b);
    });
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
  function showErrors(errs) {
    var first = null;
    Object.keys(errs).forEach(function (k) {
      setErr(k, errs[k]);
      var el = document.querySelector('[data-err="' + k + '"]');
      if (el && !first) first = el;
    });
    $('formError').textContent = '빨간 글씨로 표시된 곳을 확인해 주세요.';
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  $('applyForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (state.sending) return;
    clearAll();
    var p = payload();
    var v = R.validateApplication(p, { today: state.schedule.today, now: new Date(), closures: state.schedule.closures, openDates: state.schedule.openDates, counts: state.schedule.counts });
    if (!v.ok) { showErrors(v.errors); track('invalid', Object.keys(v.errors).sort().join(',')); return; }
    track('submit', state.photoMode === R.PHOTO_MODES[0] ? '사진 ' + photos.length + '장' : '');
    state.sending = true; $('btnSubmit').disabled = true; $('btnSubmit').textContent = '신청 저장 중…';
    var tStart = Date.now(), nPh = 0, tWaitPh = 0;
    photosReady().then(function (ids) {
      p.photoIds = ids; nPh = ids.length; tWaitPh = Date.now() - tStart;
      showWait(true, '예약을 확정하고 있어요. 잠시만 기다려 주세요…');
      return api('POST', p);
    }).then(function (r) {
      if (r && r.ok) {
        TRK.done = true; track('done', r.reservationId);
        // 고객 화면 기준 걸린 시간 + 서버 안에서 걸린 시간(나머지는 인터넷·구글 전달 시간)
        track('t_confirm', '사진' + nPh + '장 ' + ((Date.now() - tStart) / 1000).toFixed(1) + '초 (사진대기 ' + (tWaitPh / 1000).toFixed(1) + '초, 서버 ' + ((r.srv && r.srv.total) / 1000 || 0).toFixed(1) + '초, 메일까지 ' + ((r.srv && r.srv.mail) / 1000 || 0).toFixed(1) + '초)');
        var want = state.photoMode === R.PHOTO_MODES[0] ? photos.length : 0;
        showDone(r, want ? { sent: r.photos || 0, total: want } : null); return;
      }
      if (r && r.error === 'invalid' && r.errors) {
        if (r.errors.date) { state.date = ''; loadSchedule(); } // 그사이 마감된 날짜 → 달력 새로 고침
        showErrors(r.errors); track('invalid', 'server:' + Object.keys(r.errors).sort().join(',')); return;
      }
      track('fail', r && r.error);
      $('formError').textContent = r && r.error === 'busy' ? '신청이 몰리고 있어요. 잠시 후 다시 눌러 주세요.' : '저장하지 못했어요. 다시 눌러 주세요. 계속 안 되면 카카오채널로 신청해 주세요.';
    }).catch(function () {
      $('formError').textContent = '연결이 불안정해 저장을 확인하지 못했어요. 다시 눌러 주세요(중복 예약되지 않아요).';
      track('fail', 'network');
    }).then(function () {
      state.sending = false; $('btnSubmit').disabled = false; $('btnSubmit').textContent = '수거 신청하기';
      showWait(false);
    });
  });

  function showDone(r, up) {
    var dt = R.parseYmd(r.date);
    $('doneId').textContent = r.reservationId;
    $('doneDate').textContent = (dt.getUTCMonth() + 1) + '월 ' + dt.getUTCDate() + '일 (' + WD[dt.getUTCDay()] + ')';
    $('doneAddr').textContent = (state.address ? state.address.roadAddress : '') + ' ' + $('addrDetail').value;
    var later = !(up && up.pending) && (state.photoMode === R.PHOTO_MODES[1] || (up && up.sent < up.total) || (state.photoMode === R.PHOTO_MODES[0] && !photos.length));
    if (up && up.total && up.sent === up.total) { $('donePhoto').hidden = false; $('donePhoto').textContent = '✅ 사진 ' + up.sent + '장이 함께 접수됐어요.'; }
    var dp = $('donePhoto');
    if (up && up.sent === up.total) { dp.hidden = false; dp.textContent = '사진 ' + up.sent + '장이 함께 접수됐어요.'; }
    if (later) {
      dp.hidden = false;
      dp.textContent = (up && up.sent < up.total ? '사진 일부를 올리지 못했어요. ' : '') + '카카오채널로 예약번호(' + r.reservationId + ')와 함께 옷 사진을 보내 주세요.';
      $('doneKakao').textContent = '카카오채널로 사진 보내기'; $('doneKakao').className = 'ap-submit'; $('doneKakao').style.display = 'flex';
      $('doneKakao').style.alignItems = 'center'; $('doneKakao').style.justifyContent = 'center';
    }
    $('formView').hidden = true; $('doneView').hidden = false;
    try { sessionStorage.removeItem('esuda_sub_id'); } catch (e) {}
    window.scrollTo(0, 0);
  }
})();
