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
  chips('amount', R.AMOUNTS, function (t) { $('amountDetailWrap').hidden = t !== R.AMOUNT_OTHER; });
  // ---------------- 사진 (선택): 휴대폰에서 줄여서(긴 변 1280px, JPEG) 예약 확정 후 한 장씩 전송
  var photos = []; // dataURL
  chips('photoMode', R.PHOTO_MODES, function (t) {
    $('photoWrap').hidden = t !== R.PHOTO_MODES[0];
    $('photoLaterHint').hidden = t !== R.PHOTO_MODES[1];
  });
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1280 / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('img')); };
      img.src = url;
    });
  }
  function renderPhotos() {
    var box = $('photoList'); box.innerHTML = '';
    photos.forEach(function (d, i) {
      var w = document.createElement('div'); w.innerHTML = '<img alt=""><button type="button" aria-label="사진 빼기">✕</button>';
      w.querySelector('img').src = d;
      w.querySelector('button').addEventListener('click', function () { photos.splice(i, 1); renderPhotos(); });
      box.appendChild(w);
    });
  }
  $('photoInput').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []).slice(0, R.PHOTO_MAX - photos.length);
    this.value = '';
    files.reduce(function (p, f) { return p.then(function () { return shrink(f).then(function (d) { photos.push(d); }); }); }, Promise.resolve())
      .then(renderPhotos).catch(function () { renderPhotos(); setErr('amount', '사진을 읽지 못했어요. 다른 사진을 골라 주세요.'); });
  });
  function uploadPhotos(r, p) {
    var list = photos.slice(), done = 0;
    return list.reduce(function (chain, d, i) {
      return chain.then(function () {
        $('btnSubmit').textContent = '사진 올리는 중… (' + (i + 1) + '/' + list.length + ')';
        showWait(true, '예약 확정! 사진을 올리는 중이에요 (' + (i + 1) + '/' + list.length + ')');
        return api('POST', { action: 'photo', reservationId: r.reservationId, submissionId: p.submissionId, index: i + 1, data: d.split(',')[1] })
          .then(function (x) { if (x && x.ok) done++; }).catch(function () {});
      });
    }, Promise.resolve()).then(function () { return { sent: done, total: list.length }; });
  }

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
    if (!open.length) { hint.hidden = false; hint.textContent = '지금은 예약 가능한 날짜가 없어요. 카카오채널로 문의해 주세요.'; return; }
    hint.hidden = true;
    open.forEach(function (d) {
      var dt = R.parseYmd(d.date);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ap-date' + (state.date === d.date ? ' on' : '');
      b.innerHTML = '<b>' + (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate() + '</b><small>' + (d.date === sc.today ? '오늘 (5시 마감)' : WD[dt.getUTCDay()] + '요일') + '</small>';
      b.addEventListener('click', function () { state.date = d.date; clearErr('date'); renderDates(); });
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
      bank: $('bank').value, account: $('account').value, holder: $('holder').value,
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
    if (!v.ok) { showErrors(v.errors); return; }
    state.sending = true; $('btnSubmit').disabled = true; $('btnSubmit').textContent = '신청 저장 중…';
    showWait(true, '예약을 확정하고 있어요. 잠시만 기다려 주세요…');
    api('POST', p).then(function (r) {
      if (r && r.ok) {
        if (state.photoMode === R.PHOTO_MODES[0] && photos.length) return uploadPhotos(r, p).then(function (u) { showDone(r, u); });
        showDone(r); return;
      }
      if (r && r.error === 'invalid' && r.errors) {
        if (r.errors.date) { state.date = ''; loadSchedule(); } // 그사이 마감된 날짜 → 달력 새로 고침
        showErrors(r.errors); return;
      }
      $('formError').textContent = r && r.error === 'busy' ? '신청이 몰리고 있어요. 잠시 후 다시 눌러 주세요.' : '저장하지 못했어요. 다시 눌러 주세요. 계속 안 되면 카카오채널로 신청해 주세요.';
    }).catch(function () {
      $('formError').textContent = '연결이 불안정해 저장을 확인하지 못했어요. 다시 눌러 주세요(중복 예약되지 않아요).';
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
    var later = state.photoMode === R.PHOTO_MODES[1] || (up && up.sent < up.total) || (state.photoMode === R.PHOTO_MODES[0] && !photos.length);
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
