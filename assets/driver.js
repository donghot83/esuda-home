/* 이수다 기사님 수거 목록 — 코드는 이 휴대폰에만 저장, 서버에는 요청 본문으로만 보냄 */
(function () {
  'use strict';
  var CFG = window.ESUDA_APPLY || {};
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var API = isLocal ? '/api' : CFG.apiUrl; // 로컬 미리보기는 가짜 서버
  var $ = function (id) { return document.getElementById(id); };
  var KEY_STORE = 'esuda_driver_key';
  var st = { key: '', date: '', items: [], sort: 'ledger', busy: false };

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

  function fetchList(date) {
    if (st.busy) return;
    st.busy = true; $('msg').textContent = '불러오는 중…';
    post({ action: 'driverList', key: st.key, date: date || '' }).then(function (r) {
      st.busy = false;
      if (!r.ok) {
        if (r.error === 'forbidden') { save(KEY_STORE, ''); st.key = ''; showKey('코드가 맞지 않아요. 대표님께 새 코드를 받아 주세요.'); return; }
        $('msg').textContent = '목록을 못 불러왔어요. 잠시 뒤 새로고침해 주세요.'; return;
      }
      $('keyView').hidden = true; $('listView').hidden = false; $('btnRefresh').hidden = false;
      st.date = r.date; st.items = r.items; st.start = r.start; st.preview = r.preview;
      st.items.forEach(function (it, i) { it._i = i; });
      $('dayLabel').textContent = r.label;
      $('dayZone').textContent = r.weekend ? '주말 휴무' : (r.route || r.zone + ' · 동선 확정 전(17시)');
      $('msg').textContent = !r.ledger ? '장부에 이 달 시트가 없어요.' : (r.items.length ? '' : '이날 수거 예약이 없어요.');
      render();
    }).catch(function () { st.busy = false; $('msg').textContent = '인터넷 연결을 확인하고 새로고침해 주세요.'; });
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
        '</div></li>';
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

  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var li = b.closest('.dv-item'), id = li.getAttribute('data-id');
    var it = st.items.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    var prev = it.state; it.state = b.getAttribute('data-act'); render();
    post({ action: 'driverMark', key: st.key, date: st.date, id: id, name: it.name, state: it.state }).then(function (r) {
      if (!r.ok) { it.state = prev; render(); alert('저장하지 못했어요. 다시 눌러 주세요.'); }
    }).catch(function () { it.state = prev; render(); alert('인터넷 연결을 확인하고 다시 눌러 주세요.'); });
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
  $('btnRefresh').addEventListener('click', function () { fetchList(st.date); });
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
