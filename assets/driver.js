/* 이수다 기사님 수거 목록 — 코드는 이 휴대폰에만 저장, 서버에는 요청 본문으로만 보냄 */
(function () {
  'use strict';
  var CFG = window.ESUDA_APPLY || {};
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var API = isLocal ? '/api' : CFG.apiUrl; // 로컬 미리보기는 가짜 서버
  var $ = function (id) { return document.getElementById(id); };
  var KEY_STORE = 'esuda_driver_key';
  var st = { key: '', date: '', items: [], sort: 'ledger', busy: false, choose: '', pending: null };
  var PHOTO_MAX = 3;

  function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function save(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function post(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
  }
  function addDays(ymd, n) {
    var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n));
    return d.toISOString().slice(0, 10);
  }

  function showKey(err) {
    $('keyView').hidden = false; $('listView').hidden = true; $('btnRefresh').hidden = true;
    $('keyErr').textContent = err || '';
    $('keyInput').value = '';
  }

  /* 2026-11-17 속도: 본 날짜는 이 화면(메모리)에 기억 → 날짜 넘기면 바로 보여 주고 뒤에서 최신으로 바꿈.
   * 앞뒤 날짜는 미리 받아 둠. 휴대폰 저장소에는 고객 정보를 남기지 않음(메모리만). */
  var mem = {}, seq = 0;
  function prefetch(date) {
    [-1, 1].forEach(function (k) {
      var d = addDays(date, k);
      if (mem[d]) return;
      post({ action: 'driverList', key: st.key, date: d }).then(function (r) { if (r && r.ok && !mem[r.date]) mem[r.date] = r; }).catch(function () {});
    });
  }
  function fetchList(date, fresh) {
    var my = ++seq;
    if (date && mem[date] && !fresh) { show(mem[date]); $('msg').textContent = ''; }
    else $('msg').textContent = '불러오는 중…';
    st.busy = true;
    post({ action: 'driverList', key: st.key, date: date || '', fresh: !!fresh }).then(function (r) {
      if (my !== seq) return;   // 그사이 다른 날짜를 눌렀으면 버림
      st.busy = false;
      if (!r.ok) {
        if (r.error === 'forbidden') { save(KEY_STORE, ''); st.key = ''; showKey('코드가 맞지 않아요. 대표님께 새 코드를 받아 주세요.'); return; }
        $('msg').textContent = '목록을 못 불러왔어요. 잠시 뒤 새로고침해 주세요.'; return;
      }
      mem[r.date] = r;
      show(r);
      prefetch(r.date);
      if (r.cached) revalidate(r.date, my);   // 저장본을 먼저 보여 줬으면 뒤에서 장부 최신으로
    }).catch(function () { if (my !== seq) return; st.busy = false; $('msg').textContent = '인터넷 연결을 확인하고 새로고침해 주세요.'; });
  }

  /* 뒤에서 최신 목록 받아 바뀐 게 있으면 화면 갱신 (사진 올리는 중·사진 선택 중이면 화면은 그대로) */
  function revalidate(date, my) {
    post({ action: 'driverList', key: st.key, date: date, fresh: true }).then(function (r) {
      if (!r || !r.ok) return;
      var old = mem[date]; mem[date] = r;
      if (my !== seq || st.date !== date) return;
      if (st.choose || st.items.some(function (x) { return x.uploading; })) return;
      if (old && JSON.stringify(old.items) === JSON.stringify(r.items) && old.route === r.route) return;
      show(r);
    }).catch(function () {});
  }

  function show(r) {
      $('keyView').hidden = true; $('listView').hidden = false; $('btnRefresh').hidden = false;
      st.date = r.date; st.items = r.items; st.start = r.start; st.preview = r.preview;
      st.items.forEach(function (it, i) { it._i = i; });
      $('dayLabel').textContent = r.label;
      $('dayZone').textContent = r.weekend ? '주말 휴무' : (r.route || r.zone + ' · 동선 확정 전(17시)');
      $('msg').textContent = !r.ledger ? '장부에 이 달 시트가 없어요.' : (r.items.length ? '' : '이날 수거 예약이 없어요.');
      render();
  }

  function sorted() {
    var a = st.items.map(function (it, i) { it._i = i; return it; });
    if (st.sort === 'area') a = a.slice().sort(function (x, y) { return (x.area + x.addr).localeCompare(y.area + y.addr, 'ko') || x._i - y._i; });
    if (st.sort === 'route') a = a.slice().sort(function (x, y) { return (x.pv || 999) - (y.pv || 999) || x._i - y._i; });
    if (st.sort === 'todo') a = a.slice().sort(function (x, y) { return (x.state === '완료') - (y.state === '완료') || x._i - y._i; });
    return a;
  }

  function render() {
    var live = st.items.filter(function (x) { return !x.cancelled; });
    var cancels = st.items.filter(function (x) { return x.cancelled; });
    var done = live.filter(function (x) { return x.state === '완료'; }).length;
    var fail = live.filter(function (x) { return x.state === '못함'; }).length;
    $('sum').innerHTML = '<span>수거 ' + live.length + '건' + (cancels.length ? ' <em class="dv-cx">취소 ' + cancels.length + '</em>' : '') + '</span><span class="done">완료 ' + done + (fail ? ' · 못함 ' + fail : '') + '</span>';
    $('cancelBox').hidden = !cancels.length;
    $('cancelBox').innerHTML = '❌ 취소: ' + cancels.map(function (c) { return '<b>' + (c.no ? esc(c.no) + '번 ' : '') + esc(c.name) + '</b>(' + esc(c.area) + ')'; }).join(', ') + '<br><small>봉투 번호는 그대로예요. 이 번호는 건너뛰세요.</small>';
    try { drawMap(); } catch (e) {}
    $('list').innerHTML = sorted().map(function (it) {
      if (it.cancelled) {
        return '<li class="dv-item cancel"><div class="dv-top"><span class="dv-no">' + esc(it.no || (it._i + 1)) + '</span><span class="dv-name">' + esc(it.name) + '</span><span class="dv-area">' + esc(it.area) + '</span><span class="dv-badge">취소됨' + (it.cancelAt ? ' ' + esc(it.cancelAt) : '') + '</span></div>' +
          '<div class="dv-addr">' + esc(it.addr) + '</div></li>';
      }
      var cls = it.state === '완료' ? ' done' : (it.state === '못함' ? ' fail' : '');
      var rows = '';
      if (it.ready) rows += '<div class="dv-row ready"><span>고객</span>✓ 준비완료 ' + esc(String(it.ready).slice(6)) + '</div>';
      if (it.photos || it.uploading) rows += '<div class="dv-row photo"><span>수거 사진</span>' + (it.uploading ? esc(it.uploading) : '📷 ' + it.photos + '장 올림') + '</div>';
      if (it.amount) rows += '<div class="dv-row"><span>수거양</span>' + esc(it.amount) + '</div>';
      if (it.place) rows += '<div class="dv-row"><span>놓을 곳</span>' + esc(it.place) + '</div>';
      if (it.entrance) rows += '<div class="dv-row code"><span>공동현관</span>' + esc(it.entrance) + '</div>';
      var req = [it.request, it.rid ? '' : it.memo].filter(Boolean).join(' / ');
      if (req) rows += '<div class="dv-row req">' + esc(req) + '</div>';
      var tel = String(it.phone || '').replace(/[^0-9]/g, '');
      var map = 'https://map.naver.com/p/search/' + encodeURIComponent(it.map || (it.area + ' ' + it.addr));
      return '<li class="dv-item' + cls + '" data-id="' + esc(it.id) + '">' +
        '<div class="dv-top"><span class="dv-no">' + esc(it.no || (it._i + 1)) + '</span><span class="dv-name">' + esc(it.name) + '</span><span class="dv-area">' + esc(it.area) + '</span><span class="dv-src">' + esc(it.src) + '</span></div>' +
        '<div class="dv-addr">' + esc(it.road || it.addr) + '</div>' + rows +
        '<div class="dv-btns">' +
          (tel ? '<a href="tel:' + tel + '">📞 전화</a><a href="sms:' + tel + '">💬 문자</a>' : '<a aria-disabled="true" style="opacity:.35">📞 전화</a><a aria-disabled="true" style="opacity:.35">💬 문자</a>') +
          '<a class="map" href="' + map + '" target="_blank" rel="noopener">🗺 네이버지도</a>' +
          '<button type="button" class="ok" data-act="' + (it.state === '완료' ? '' : '완료') + '">' + (it.state === '완료' ? '✓ 완료됨 (되돌리기)' : '수거 완료') + '</button>' +
          '<button type="button" class="no" data-act="' + (it.state === '못함' ? '' : '못함') + '">' + (it.state === '못함' ? '못함 취소' : '못 가져옴') + '</button>' +
        '</div>' +
        (st.choose === it.id && it.state !== '완료' ? '<div class="dv-pick"><b>물품 사진을 찍을까요?</b><small>' + (it.rid ? '찍은 사진은 고객 픽업 완료 알림톡에 [수거 사진 보기]로 같이 가요.' : '사진은 회사 드라이브에 보관돼요.') + '</small>' +
          '<button type="button" class="cam" data-photo="1">📷 사진 찍고 완료</button><button type="button" data-photo="0">사진 없이 완료</button><button type="button" class="x" data-photo="x">닫기</button></div>' : '') +
        (it.state === '완료' && (it.photos || 0) < PHOTO_MAX && !it.uploading ? '<button type="button" class="dv-addphoto" data-addphoto="1">📷 사진 추가</button>' : '') +
        '</li>';
    }).join('');
  }

  var map = null, layer = null;
  function drawMap() {
    var box = $('mapBox');
    if (!window.L) { box.hidden = true; return; }
    var pts = st.items.filter(function (it) { return it.lat && !it.cancelled; });
    box.hidden = !pts.length;
    if (!pts.length) return;
    var usePv = st.preview && pts.some(function (it) { return it.pv; });
    var num = function (it) { return usePv ? it.pv : (it.no || (it._i + 1)); };
    pts.sort(function (a, b) { return num(a) - num(b); });
    $('mapNote').textContent = usePv ? '동선 미리보기 (17시 확정 전 — 번호는 확정 때 정해져요)' : '장부 번호 순서';
    if (!map) {
      map = L.map('map', { zoomControl: true, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    var line = pts.map(function (it) { return [it.lat, it.lng]; });
    L.polyline(line, { color: '#e11d48', weight: 4, opacity: 0.85 }).addTo(layer);
    if (st.start) L.marker([st.start.lat, st.start.lng], { icon: L.divIcon({ className: '', html: '<div class="dv-pin start">출발</div>', iconSize: [34, 28], iconAnchor: [17, 14] }) }).bindPopup(st.start.label).addTo(layer);
    pts.forEach(function (it) {
      var cls = it.state === '완료' ? ' done' : (usePv ? ' pv' : '');
      L.marker([it.lat, it.lng], { icon: L.divIcon({ className: '', html: '<div class="dv-pin' + cls + '">' + num(it) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) })
        .bindPopup('<b>' + num(it) + '. ' + esc(it.name) + '</b><br>' + esc(it.area) + ' ' + esc(it.road || it.addr) + (it.geo === '구청' ? '<br><small>※ 주소 위치 확인 필요(구 중심으로 표시)</small>' : ''))
        .addTo(layer);
    });
    var b = L.latLngBounds(line); if (st.start) b.extend([st.start.lat, st.start.lng]);
    setTimeout(function () { map.invalidateSize(); map.fitBounds(b, { padding: [24, 24] }); }, 50);
  }

  function mark(it, state) {
    var prev = it.state; it.state = state; st.choose = ''; render();
    post({ action: 'driverMark', key: st.key, date: st.date, id: it.id, name: it.name, state: state }).then(function (r) {
      if (!r.ok) { it.state = prev; render(); alert('저장하지 못했어요. 다시 눌러 주세요.'); }
    }).catch(function () { it.state = prev; render(); alert('인터넷 연결을 확인하고 다시 눌러 주세요.'); });
  }

  /* 수거 사진 (2026-11-16): 휴대폰에서 1280px JPEG 로 줄여 한 장씩 올림 */
  var fileIn = document.createElement('input');
  fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.setAttribute('capture', 'environment'); fileIn.multiple = true; fileIn.hidden = true;
  document.body.appendChild(fileIn);
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('img')); };
      img.src = url;
    });
  }
  fileIn.addEventListener('change', function () {
    var pend = st.pending, files = Array.prototype.slice.call(fileIn.files || []); st.pending = null; fileIn.value = '';
    if (!pend || !files.length) return;
    var it = st.items.filter(function (x) { return x.id === pend.id; })[0]; if (!it) return;
    files = files.slice(0, Math.max(0, PHOTO_MAX - (it.photos || 0)));
    var i = 0, failed = false;
    (function next() {
      if (i >= files.length) {
        it.uploading = '';
        if (failed && pend.done) { render(); if (confirm('사진을 못 올렸어요. 사진 없이 완료할까요?')) mark(it, '완료'); return; }
        if (failed) alert('사진을 못 올렸어요. 인터넷 연결을 확인하고 다시 올려 주세요.');
        if (pend.done) mark(it, '완료'); else render();
        return;
      }
      it.uploading = '사진 올리는 중… ' + (i + 1) + '/' + files.length; render();
      shrink(files[i]).then(function (data) {
        return post({ action: 'driverPhoto', key: st.key, date: st.date, id: it.id, name: it.name, data: data });
      }).then(function (r) {
        if (r && r.ok) it.photos = r.count; else failed = true;
        i++; next();
      }).catch(function () { failed = true; i++; next(); });
    })();
  });

  $('list').addEventListener('click', function (e) {
    var li = e.target.closest('.dv-item'); if (!li) return;
    var id = li.getAttribute('data-id');
    var it = st.items.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    var ph = e.target.closest('button[data-photo]');
    if (ph) {
      var w = ph.getAttribute('data-photo');
      if (w === 'x') { st.choose = ''; render(); return; }
      if (w === '0') { mark(it, '완료'); return; }
      st.pending = { id: id, done: true }; fileIn.click(); return;   // 카메라는 누른 순간에 열어야 함(아이폰)
    }
    if (e.target.closest('button[data-addphoto]')) { st.pending = { id: id, done: false }; fileIn.click(); return; }
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === '완료') { st.choose = st.choose === id ? '' : id; render(); return; }   // 사진 찍을지 먼저 물어봄
    mark(it, act);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.dv-sort button'), function (b) {
    b.addEventListener('click', function () {
      st.sort = b.getAttribute('data-sort');
      Array.prototype.forEach.call(document.querySelectorAll('.dv-sort button'), function (x) { x.classList.toggle('on', x === b); });
      render();
    });
  });
  $('btnPrev').addEventListener('click', function () { fetchList(addDays(st.date, -1)); });
  $('btnNext').addEventListener('click', function () { fetchList(addDays(st.date, 1)); });
  $('btnRefresh').addEventListener('click', function () { fetchList(st.date, true); });   // 새로고침은 서버 캐시 없이 최신
  $('btnLogout').addEventListener('click', function () { save(KEY_STORE, ''); st.key = ''; showKey(''); });
  $('btnKey').addEventListener('click', function () {
    var k = $('keyInput').value.replace(/\s+/g, '').toUpperCase();
    if (k.length < 6) { $('keyErr').textContent = '코드를 확인해 주세요.'; return; }
    st.key = k; save(KEY_STORE, k); fetchList('');
  });
  $('keyInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnKey').click(); });

  if (!API) { showKey('서버 설정이 아직 없어요.'); return; }
  st.key = load(KEY_STORE);
  if (st.key) fetchList(''); else showKey('');
})();
