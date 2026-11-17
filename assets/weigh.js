/* 이수다 계량 화면 (2026-11-17) — ① 계량(봉지·무게·계량 사진) ② 로스(나중에 따로)
 * 사진은 폰 기본 카메라로 찍어 갤러리에 남기고(백업), 여기서는 갤러리에서 골라 올린다.
 * 코드는 이 휴대폰에만 저장, 서버에는 요청 본문으로만. 고객 연락처·주소·계좌는 받지 않는다. */
(function () {
  'use strict';
  var CFG = window.ESUDA_APPLY || {};
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var API = isLocal ? '/api' : CFG.apiUrl;
  var $ = function (id) { return document.getElementById(id); };
  var KEY_STORE = 'esuda_weigh_key';
  var st = { key: '', date: '', items: [], tab: 'weigh', open: '', up: {}, seq: {}, busy: false, thumbs: {}, exclCol: false, unit: 250, lossUnit: 200 };

  function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function save(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function post(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
  }
  function addDays(ymd, n) { var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)); return d.toISOString().slice(0, 10); }
  function kg(v) { return v === '' || v == null ? '' : (Math.round(+v * 100) / 100) + 'kg'; }
  function label(it) { return it.bags === '' || it.bags == null ? (it.no || '?') + '번' : (it.no || '?') + '-' + it.bags; }   // 봉지 수 넣으면 1-3
  function weightOf(it) { return it.weighed ? it.ledgerWeight : ''; }

  function showKey(err) { $('keyView').hidden = false; $('listView').hidden = true; $('btnRefresh').hidden = true; $('keyErr').textContent = err || ''; $('keyInput').value = ''; }

  /* 2026-11-17 속도: 본 날짜는 이 화면(메모리)에 기억 → 바로 보여 주고 뒤에서 최신으로. 앞뒤 날짜는 미리 받아 둠 */
  var mem = {}, reqSeq = 0;
  function show(r) {
    $('keyView').hidden = true; $('listView').hidden = false; $('btnRefresh').hidden = false;
    if (r.date !== st.date) { st.open = ''; st.thumbs = {}; }
    st.date = r.date; st.items = r.items; st.exclCol = !!r.exclCol; st.unit = r.unit || 250; st.lossUnit = r.lossUnit || 200;
    $('dayLabel').textContent = r.label;
    $('msg').textContent = !r.ledger ? '장부에 이 달 시트가 없어요.' : (r.items.length ? '' : '이날 수거가 없어요.');
    render();
  }
  function prefetch(date) {
    [-1, 1].forEach(function (k) {
      var d = addDays(date, k);
      if (mem[d]) return;
      post({ action: 'weighList', key: st.key, date: d }).then(function (r) { if (r && r.ok && !mem[r.date]) mem[r.date] = r; }).catch(function () {});
    });
  }
  function revalidate(date, my) {
    post({ action: 'weighList', key: st.key, date: date, fresh: true }).then(function (r) {
      if (!r || !r.ok) return;
      var old = mem[date]; mem[date] = r;
      if (my !== reqSeq || st.date !== date || st.open) return;   // 입력 중이면 화면은 그대로
      if (old && JSON.stringify(old.items) === JSON.stringify(r.items) && old.exclCol === r.exclCol) return;
      show(r);
    }).catch(function () {});
  }
  function fetchList(date, fresh) {
    var my = ++reqSeq;
    if (date && mem[date] && !fresh) { show(mem[date]); $('msg').textContent = ''; }
    else $('msg').textContent = '불러오는 중…';
    st.busy = true;
    post({ action: 'weighList', key: st.key, date: date || '', fresh: !!fresh }).then(function (r) {
      if (my !== reqSeq) return;
      st.busy = false;
      if (!r.ok) {
        if (r.error === 'forbidden') { save(KEY_STORE, ''); st.key = ''; showKey('코드가 맞지 않아요. 대표님께 계량 화면 코드를 받아 주세요.'); return; }
        $('msg').textContent = '목록을 못 불러왔어요. 새로고침해 주세요.'; return;
      }
      mem[r.date] = r;
      if (!(st.open && st.date === r.date)) show(r);
      prefetch(r.date);
      if (r.cached) revalidate(r.date, my);
    }).catch(function () { if (my !== reqSeq) return; st.busy = false; $('msg').textContent = '인터넷 연결을 확인하고 새로고침해 주세요.'; });
  }

  function live() { return st.items.filter(function (x) { return !x.cancelled; }); }
  function lossTargets() { return live().filter(function (x) { return !x.free && +x.ledgerWeight >= 15; }); }   // 무상 희망·15kg 미만은 로스 없음

  function render() {
    var keep = {};   // 다시 그려도 입력하던 값은 그대로
    ['inBags', 'inW', 'inL', 'inX'].forEach(function (k) { var el = $(k); if (el) keep[k] = el.value; });
    renderInner();
    Object.keys(keep).forEach(function (k) { var el = $(k); if (el) el.value = keep[k]; });
    if (st.tab === 'loss') calcPreview();
  }
  function renderInner() {
    var L = live(), w = L.filter(function (x) { return x.weighed; }).length, lt = lossTargets(), ld = lt.filter(function (x) { return x.lossDone; }).length;
    $('cntWeigh').textContent = w + '/' + L.length;
    $('cntLoss').textContent = ld + '/' + lt.length;
    Array.prototype.forEach.call(document.querySelectorAll('.wg-tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === st.tab); });
    $('help').textContent = st.tab === 'weigh'
      ? '고객을 눌러 봉지 수·무게를 넣고, 갤러리에서 계량 사진을 골라 저장해요. 장부에 적힌 무게와 다르면 한 번 더 물어봐요.'
      : '로스(폐기물)는 무게에서 빼고 kg당 ' + st.lossUnit + '원 공제, 무상제외(박스·이불 등)는 무게에서만 빼요. 15kg 미만·무상 희망 고객은 로스가 필요 없어서 여기 안 나와요. 정하기 전에는 그 고객 입금이 이체 파일에서 빠져요.';
    var list = st.tab === 'weigh' ? st.items : lossTargets().slice().sort(function (a, b) { return (a.lossDone - b.lossDone); });
    $('list').innerHTML = list.map(function (it) { return st.tab === 'weigh' ? weighCard(it) : lossCard(it); }).join('') ||
      (st.tab === 'loss' ? '<li class="dv-sub">계량한 고객이 아직 없어요.</li>' : '');
    if (st.tab === 'loss') calcPreview();
  }

  function thumbsHtml(it, kind) {
    var have = (st.thumbs[it.id] || []).filter(function (p) { return p.kind === kind; });
    var ups = (st.up[it.id + '|' + kind] || []);
    var lab = { up: '올리는 중…', ok: '✓ 저장됨', fail: '실패 · 다시' };
    return '<div class="wg-pics">' +
      have.map(function (p) { return '<div class="wg-pic"><span class="k">' + esc(p.kind) + '</span>' + (p.data ? '<img alt="" src="data:image/jpeg;base64,' + p.data + '">' : '') + '<button type="button" class="x" data-del="' + esc(p.fileId) + '" aria-label="사진 지우기">✕</button></div>'; }).join('') +
      ups.map(function (u, i) {
        return '<div class="wg-pic new ' + u.state + '"><span class="k">' + lab[u.state] + '</span><img alt="" src="' + u.data + '">' +
          (u.state === 'up' ? '' : '<button type="button" class="x" data-unpick="' + kind + '|' + i + '" aria-label="빼기">✕</button>') +
          (u.state === 'fail' ? '<button type="button" class="retry" data-retry="' + kind + '|' + i + '">다시 올리기</button>' : '') + '</div>';
      }).join('') +
      '</div>';
  }

  function weighCard(it) {
    var id = esc(it.id);
    if (it.cancelled) return '<li class="wg-item cx"><div class="wg-row"><span class="wg-lab">' + esc(it.no || '?') + '</span><span class="wg-name">' + esc(it.name) + '</span><span class="wg-st">취소</span></div></li>';
    var ok = it.weighed && (it.free || it.photos.계량 > 0);
    var stat = it.weighed ? '<b class="good">' + kg(it.ledgerWeight) + ' ✓</b>' : (it.ledgerWeight !== '' ? '<span>장부 ' + kg(it.ledgerWeight) + '</span>' : '<span class="warn">무게 전</span>');
    stat += '<br>' + (it.free ? '<span class="free">무상 · 사진 없음</span>' : (it.photos.계량 ? '📷 ' + it.photos.계량 + '장' : '<span class="warn">사진 없음</span>')) +
      (!it.free && it.weighed && +it.ledgerWeight < 15 ? '<br><span class="free">15kg 미만 · 무상 (로스 없음)</span>' : '');
    var html = '<li class="wg-item' + (ok ? ' ok' : '') + '" data-id="' + id + '"><button type="button" class="wg-row" data-open="1"><span class="wg-lab">' + esc(label(it)) + '</span><span><span class="wg-name">' + esc(it.name) + '</span><br><span class="wg-area">' + esc(it.area) + (it.rid ? ' · 신청 ' + esc(it.rid) : ' · 카톡·직원') + '</span>' + (it.free ? ' <span class="wg-free">무상 희망</span>' : '') + '</span><span class="wg-st">' + stat + '</span></button>';
    if (st.open === it.id) {
      var wv = it.weighed ? it.ledgerWeight : (it.ledgerWeight !== '' ? it.ledgerWeight : '');
      html += '<div class="wg-ed">' +
        '<div class="wg-f"><label>봉지 수<input type="number" inputmode="numeric" min="0" max="99" id="inBags" value="' + esc(it.bags) + '" placeholder="3"></label>' +
        '<label>무게 (kg)<input type="number" inputmode="decimal" step="0.1" min="0" id="inW" value="' + esc(wv) + '" placeholder="0.0"></label></div>' +
        (it.ledgerWeight !== '' && !it.weighed ? '<p class="wg-note">장부에 적힌 무게: <b>' + kg(it.ledgerWeight) + '</b> — 저울 값과 같으면 그대로 저장</p>' : '') +
        (it.free ? '<p class="wg-note">무상 희망 고객이에요. <b>사진·로스 없이 무게만</b> 넣으면 돼요. 입금 대신 무상수거 안내 알림톡이 가요.</p>' +
          '<div class="wg-btns"><button type="button" class="save wide" data-save="weigh">저장</button></div>' :
        thumbsHtml(it, '계량') +
        (it.photos.계량 && !st.thumbs[it.id] ? '<button type="button" class="wg-link" data-thumbs="1">올린 사진 ' + it.photos.계량 + '장 보기·지우기</button>' : '') +
        '<div class="wg-btns"><button type="button" data-pick="계량">📷 계량 사진 고르기</button><button type="button" class="save" data-save="weigh">저장</button></div>') +
        '<p class="wg-note" id="edMsg"></p></div>';
    }
    return html + '</li>';
  }

  function lossCard(it) {
    var id = esc(it.id), w = it.ledgerWeight;
    var stat = it.lossDone ? '<b class="good">' + (it.loss > 0 ? '로스 ' + kg(it.loss) : '로스 없음') + (it.ledgerExcl > 0 ? ' · 제외 ' + kg(it.ledgerExcl) : '') + ' ✓</b>' : '<span class="warn">로스 미정</span>';
    stat += '<br><span>' + kg(w) + (it.photos.로스 ? ' · 📷 ' + it.photos.로스 : '') + '</span>';
    var html = '<li class="wg-item' + (it.lossDone ? ' ok' : '') + '" data-id="' + id + '"><button type="button" class="wg-row" data-open="1"><span class="wg-lab">' + esc(label(it)) + '</span><span><span class="wg-name">' + esc(it.name) + '</span><br><span class="wg-area">' + esc(it.area) + '</span></span><span class="wg-st">' + stat + '</span></button>';
    if (st.open === it.id) {
      var cur = it.lossDone ? it.loss : (it.ledgerLoss !== '' ? it.ledgerLoss : '');
      var curX = it.ledgerExcl !== '' && it.ledgerExcl != null ? it.ledgerExcl : '';
      html += '<div class="wg-ed">' +
        '<p class="wg-note">무게 <b>' + esc(kg(w)) + '</b></p>' +
        '<div class="wg-f">' + (st.exclCol ? '<label>무상제외 (kg)<small> 박스·이불 등</small><input type="number" inputmode="decimal" step="0.1" min="0" id="inX" value="' + esc(curX) + '" placeholder="0"></label>' : '') +
        '<label>로스 (kg)<small> 폐기물 −' + st.lossUnit + '원/kg</small><input type="number" inputmode="decimal" step="0.1" min="0" id="inL" value="' + esc(cur) + '" placeholder="0"></label></div>' +
        (st.exclCol ? '' : '<p class="wg-note">장부에 「무상제외」 칸이 아직 없어서 무상제외는 넣을 수 없어요.</p>') +
        '<p class="wg-calc" id="calc"></p>' +
        (it.ledgerLoss !== '' && !it.lossDone ? '<p class="wg-note">장부에 적힌 로스: <b>' + kg(it.ledgerLoss) + '</b></p>' : '') +
        thumbsHtml(it, '로스') +
        (it.photos.로스 && !st.thumbs[it.id] ? '<button type="button" class="wg-link" data-thumbs="1">로스 사진 ' + it.photos.로스 + '장 보기·지우기</button>' : '') +
        '<div class="wg-btns"><button type="button" class="none wide" data-save="none">로스·제외 없음 (0kg)</button>' +
        '<button type="button" data-pick="로스">📷 로스 사진 고르기</button><button type="button" class="save" data-save="loss">로스 저장</button></div>' +
        '<p class="wg-note" id="edMsg"></p></div>';
    }
    return html + '</li>';
  }

  /* 사진: 갤러리에서 고르기(여러 장) → 1280px JPEG 로 줄여 미리보기, 저장 때 올림 */
  var fileIn = document.createElement('input');
  fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.multiple = true; fileIn.hidden = true;
  document.body.appendChild(fileIn);
  var picking = null;
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {   // 2026-11-17: 1024px·0.7 로 줄여 올리기 빠르게 (무게 숫자는 충분히 보임)
        var k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('img')); };
      img.src = url;
    });
  }
  fileIn.addEventListener('change', function () {
    var p = picking, files = Array.prototype.slice.call(fileIn.files || []).slice(0, 6); picking = null; fileIn.value = '';
    if (!p || !files.length) return;
    var key = p.id + '|' + p.kind, it = st.items.filter(function (x) { return x.id === p.id; })[0];
    if (!it) return;
    Promise.all(files.map(function (f) { return shrink(f).catch(function () { return ''; }); })).then(function (arr) {
      if (st.seq[key] == null) st.seq[key] = it.photos[p.kind] || 0;
      st.up[key] = (st.up[key] || []).concat(arr.filter(Boolean).map(function (d) { return { data: d, state: 'up', seq: ++st.seq[key] }; }));
      render();
      pump(it, p.kind);   // 고르는 즉시 올리기 시작 — 무게를 넣는 동안 올라감
    });
  });

  /* 사진 올리기: 한 번에 3장까지 동시에, 끝나면 다음 것 */
  var running = 0, MAXRUN = 3, waiters = [];
  function pending() { return Object.keys(st.up).reduce(function (n, k) { return n + st.up[k].filter(function (u) { return u.state === 'up'; }).length; }, 0); }
  function pump(it, kind) {
    var key = it.id + '|' + kind;
    (st.up[key] || []).forEach(function (u) {
      if (u.state !== 'up' || u.sending || running >= MAXRUN) return;
      u.sending = true; running++;
      post({ action: 'weighPhoto', key: st.key, date: st.date, id: it.id, kind: kind, name: it.name, no: it.no, bags: it.bags, seq: u.seq, data: u.data }).then(function (r) {
        if (r && r.ok) { u.state = 'ok'; u.fileId = r.fileId; it.photos[kind] = Math.max(it.photos[kind] || 0, r.count); }
        else u.state = r && r.error === 'free' ? 'fail' : 'fail';
      }).catch(function () { u.state = 'fail'; }).then(function () {
        u.sending = false; running--;
        render(); pump(it, kind);
        if (!pending()) { var w = waiters; waiters = []; w.forEach(function (f) { f(); }); }
      });
    });
  }
  function waitUploads() { return pending() ? new Promise(function (ok) { waiters.push(ok); }) : Promise.resolve(); }
  function failsOf(it, kind) { return (st.up[it.id + '|' + kind] || []).filter(function (u) { return u.state === 'fail'; }).length; }

  /* 로스 탭: 입력하는 동안 최종 무게·예상 금액 (장부 수식과 같은 계산) */
  function calcPreview() {
    var el = $('calc'), it = st.items.filter(function (x) { return x.id === st.open; })[0];
    if (!el || !it) return;
    var w = +it.ledgerWeight || 0, x = $('inX') ? (+$('inX').value || 0) : 0, l = +$('inL').value || 0, fin = Math.round((w - x - l) * 100) / 100;
    if (!(w > 0)) { el.textContent = ''; return; }
    if (x + l > w) { el.innerHTML = '<span class="warn">제외+로스가 무게보다 커요</span>'; return; }
    el.innerHTML = '최종 <b>' + fin + 'kg</b> · ' + (fin >= 15 ? '예상 금액 <b>' + Math.round(fin * st.unit - l * st.lossUnit).toLocaleString('ko-KR') + '원</b>' : '<b>무상수거</b> (15kg 미만)');
  }
  $('list').addEventListener('input', function (e) { if (e.target.id === 'inL' || e.target.id === 'inX') calcPreview(); });

  function setMsg(t, warn) { var el = $('edMsg'); if (el) { el.textContent = t; el.className = 'wg-note' + (warn ? ' warn' : ''); } }
  function disableEd(on) { Array.prototype.forEach.call(document.querySelectorAll('.wg-ed button, .wg-ed input'), function (b) { b.disabled = on; }); }

  function afterSave(it, kind, okMsg, needPhoto) {
    var n = pending();
    if (n) setMsg('저장했어요. 사진 올리는 중… (' + n + '장 남음)');
    return waitUploads().then(function () {
      disableEd(false);
      var fail = failsOf(it, kind);
      if (fail) { render(); setMsg(okMsg + ' 사진 ' + fail + '장을 못 올렸어요 — 사진의 「다시 올리기」를 눌러 주세요.', true); return; }
      if (needPhoto && !it.photos[kind]) { render(); setMsg(okMsg + ' ' + kind + ' 사진도 골라 주세요.', true); return; }
      st.open = ''; render();
    });
  }

  function saveWeigh(it, force) {
    var bags = $('inBags').value, w = $('inW').value;
    if (!(+w > 0)) { setMsg('무게를 넣어 주세요.', true); return; }
    disableEd(true); setMsg('저장 중…');
    post({ action: 'weighSave', key: st.key, date: st.date, id: it.id, bags: bags, weight: w, force: !!force }).then(function (r) {
      if (!r.ok && r.error === 'mismatch') {
        disableEd(false);
        if (confirm('장부에는 ' + r.ledger + 'kg로 적혀 있어요.\n' + w + 'kg로 바꿀까요?\n\n(취소를 누르면 그대로 두고 다시 확인할 수 있어요)')) return saveWeigh(it, true);
        setMsg('장부 값(' + r.ledger + 'kg)과 달라서 저장하지 않았어요. 저울 값을 다시 확인해 주세요.', true); return;
      }
      if (!r.ok) { disableEd(false); setMsg(r.error === 'bad_weight' ? '무게를 확인해 주세요.' : '저장하지 못했어요. 다시 눌러 주세요.', true); return; }
      it.weighed = true; it.ledgerWeight = r.weight; it.bags = r.bags;
      afterSave(it, '계량', '무게 저장 ✓', !it.free);
    }).catch(function () { disableEd(false); setMsg('인터넷 연결을 확인하고 다시 눌러 주세요.', true); });
  }

  function saveLoss(it, loss, force, excl) {
    if (excl == null) excl = $('inX') ? $('inX').value : '';
    if (loss === '' && +excl > 0) loss = 0;
    if (loss === '' || isNaN(+loss) || +loss < 0 || (excl !== '' && (isNaN(+excl) || +excl < 0))) { setMsg('로스 kg을 넣거나 "로스·제외 없음"을 눌러 주세요.', true); return; }
    disableEd(true); setMsg('저장 중…');
    post({ action: 'lossSave', key: st.key, date: st.date, id: it.id, loss: loss, excl: excl, force: !!force }).then(function (r) {
      if (!r.ok && r.error === 'mismatch') {
        disableEd(false);
        var what = r.what || '로스', now = what === '무상제외' ? (+excl || 0) : loss;
        if (confirm('장부에는 ' + what + ' ' + r.ledger + 'kg로 적혀 있어요.\n' + now + 'kg로 바꿀까요?')) return saveLoss(it, loss, true, excl);
        setMsg('장부 ' + what + ' 값(' + r.ledger + 'kg)과 달라서 저장하지 않았어요.', true); return;
      }
      if (!r.ok) { disableEd(false); setMsg(r.error === 'loss_over' ? '제외+로스가 무게보다 커요. 확인해 주세요.' : r.error === 'no_excl_col' ? '장부에 무상제외 칸이 아직 없어요.' : '저장하지 못했어요. 다시 눌러 주세요.', true); return; }
      it.lossDone = true; it.loss = r.loss; it.ledgerLoss = r.loss > 0 ? r.loss : ''; it.ledgerExcl = r.excl > 0 ? r.excl : '';
      afterSave(it, '로스', '로스 저장 ✓', r.loss > 0);
    }).catch(function () { disableEd(false); setMsg('인터넷 연결을 확인하고 다시 눌러 주세요.', true); });
  }

  $('list').addEventListener('click', function (e) {
    var li = e.target.closest('.wg-item'); if (!li) return;
    var id = li.getAttribute('data-id'), it = st.items.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    if (e.target.closest('[data-open]')) { st.open = st.open === id ? '' : id; render(); var el = document.querySelector('.wg-item[data-id="' + CSS.escape(id) + '"]'); if (el && st.open) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    var b;
    if ((b = e.target.closest('[data-pick]'))) { picking = { id: id, kind: b.getAttribute('data-pick') }; fileIn.click(); return; }   // 누른 순간 열어야 함(아이폰)
    if ((b = e.target.closest('[data-unpick]'))) {
      var p = b.getAttribute('data-unpick').split('|'), arr = st.up[id + '|' + p[0]] || [], u = arr[+p[1]];
      if (!u) return;
      if (u.state === 'ok') {
        if (!confirm('이미 저장된 사진이에요. 지울까요?')) return;
        post({ action: 'weighPhotoDel', key: st.key, fileId: u.fileId }).then(function (r) { if (r && r.ok) { arr.splice(arr.indexOf(u), 1); it.photos[p[0]] = Math.max(0, (it.photos[p[0]] || 1) - 1); render(); } else alert('지우지 못했어요.'); });
        return;
      }
      arr.splice(+p[1], 1); render(); return;
    }
    if ((b = e.target.closest('[data-retry]'))) { var q = b.getAttribute('data-retry').split('|'), uu = (st.up[id + '|' + q[0]] || [])[+q[1]]; if (uu) { uu.state = 'up'; render(); pump(it, q[0]); } return; }
    if (e.target.closest('[data-thumbs]')) {
      setMsg('사진 불러오는 중…');
      post({ action: 'weighThumbs', key: st.key, date: st.date, id: id }).then(function (r) {
        st.thumbs[id] = (r && r.photos) || [];
        ['계량', '로스'].forEach(function (k) { var a = st.up[id + '|' + k]; if (a) st.up[id + '|' + k] = a.filter(function (u) { return u.state !== 'ok'; }); });
        render();
      }).catch(function () { setMsg('사진을 못 불러왔어요.', true); });
      return;
    }
    if ((b = e.target.closest('[data-del]'))) {
      if (!confirm('이 사진을 지울까요?')) return;
      var fid = b.getAttribute('data-del');
      post({ action: 'weighPhotoDel', key: st.key, fileId: fid }).then(function (r) {
        if (!r.ok) { alert('지우지 못했어요.'); return; }
        var arr = st.thumbs[id] || [], gone = arr.filter(function (x) { return x.fileId === fid; })[0];
        st.thumbs[id] = arr.filter(function (x) { return x.fileId !== fid; });
        if (gone) it.photos[gone.kind] = Math.max(0, (it.photos[gone.kind] || 1) - 1);
        render();
      });
      return;
    }
    if ((b = e.target.closest('[data-save]'))) {
      var w = b.getAttribute('data-save');
      if (w === 'weigh') saveWeigh(it);
      else if (w === 'none') saveLoss(it, 0, false, 0);
      else saveLoss(it, $('inL').value);
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.wg-tabs button'), function (b) {
    b.addEventListener('click', function () { st.tab = b.getAttribute('data-tab'); st.open = ''; render(); });
  });
  $('btnPrev').addEventListener('click', function () { fetchList(addDays(st.date, -1)); });
  $('btnNext').addEventListener('click', function () { fetchList(addDays(st.date, 1)); });
  $('btnRefresh').addEventListener('click', function () { fetchList(st.date, true); });
  $('btnLogout').addEventListener('click', function () { save(KEY_STORE, ''); st.key = ''; showKey(''); });
  $('btnKey').addEventListener('click', function () {
    var k = $('keyInput').value.replace(/\s+/g, '').toUpperCase();
    if (k.length < 6) { $('keyErr').textContent = '코드를 확인해 주세요.'; return; }
    st.key = k; save(KEY_STORE, k); fetchList('');
  });
  $('keyInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnKey').click(); });
  window.addEventListener('beforeunload', function (e) {
    var any = pending() > 0;
    if (any) { e.preventDefault(); e.returnValue = ''; }
  });

  if (!API) { showKey('서버 설정이 아직 없어요.'); return; }
  st.key = load(KEY_STORE);
  if (st.key) fetchList(''); else showKey('');
})();
