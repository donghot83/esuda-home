// 로컬 미리보기: 홈페이지 파일 + 가짜 예약 서버(/api). 실제 구글 시트·고객 정보 없음.
// 사용: node tools/mock_server.js  →  http://localhost:8787/apply/
// 테스트용 마감: /api?action=mockClose&date=YYYY-MM-DD&msg=... (로컬 전용)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createEnv } = require('../tests/gas-harness.js');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 8787;
// 기사님 화면 미리보기용 가상 장부 (가상 데이터만) — 기사님 코드: LOCALTEST1
const D = s => new Date(s + 'T00:00:00+09:00');
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const yday = new Date(Date.now() + 9 * 3600e3 - 864e5).toISOString().slice(0, 10);
const env = createEnv({ staffToken: 'local-test-token', props: { DRIVER_KEY: 'LOCALTEST1', WEIGH_KEY: 'LOCALWEIGH1' },
  geo: { '서울 은평구 가상로 12 301호': [37.6027, 126.9291], '서울 마포구 가상북로 5 2층': [37.5663, 126.9019], '서울 모래내로3길 7': [37.5649, 126.9050] }, ledger: {
  [(+today.slice(5, 7)) + '월 매입금액']: [
    [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', null],
    [null, D(today), '가상카톡', '은평구', '가상로 12 301호', null, null, null, null, null, '카톡 예약 / 비번 #1234'],
    [null, D(today), '가상직원', '마포구', '가상북로 5 2층', null, null, null, null, null, ''],
    [null, D(today), '가상취소', '서대문구', '가상로 9', null, null, null, null, null, '[취소 11/15 17:20] 카톡 예약'],
    // 계량 화면 미리보기용 (어제 수거분, 계량 코드: LOCALWEIGH1)
    [1, D(yday), '가상하나', '은평구', '가상로 1', 32, null, null, null, null, '카톡 예약'],
    [2, D(yday), '가상둘', '마포구', '가상로 2', null, null, null, null, null, ''],
    [3, D(yday), '가상셋', '서대문구', '가상로 3', 18.5, 2, null, null, null, '']
  ] } });
env.get({ action: 'schedule' }); // 시트 만들기
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };

let MOCK_DELAY = 0, MOCK_FAIL = '';  // 로컬 시험용: 서버 지연(ms)·실패 흉내
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/assets/apply-config.js') { // 로컬에선 가짜 서버(/api)로
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end("window.ESUDA_APPLY = { apiUrl: '', kakaoUrl: 'https://pf.kakao.com/_DxoHVG/chat' };");
  }
  if (u.pathname === '/api' && u.searchParams.get('action') === 'mockSet') {
    MOCK_DELAY = +u.searchParams.get('delay') || 0; MOCK_FAIL = u.searchParams.get('fail') || '';
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
  }
  if (u.pathname === '/api') {
    if (req.method === 'GET' && u.searchParams.get('action') === 'mockClose') {
      env.sheet('마감').appendRow([u.searchParams.get('date'), u.searchParams.get('end') || '', u.searchParams.get('zone') || 'all', u.searchParams.get('msg') || '', 'mock']);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
    }
    if (req.method === 'GET' && u.searchParams.get('action') === 'mockDump') { // 로컬 확인용: 저장된 예약(가상 데이터)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(env.sheet('예약').rows));
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(env.get(Object.fromEntries(u.searchParams))));
    }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      setTimeout(() => {
        let out;
        const isSubmit = /"action":"submit"/.test(body);
        if (isSubmit && MOCK_FAIL === 'network') { res.destroy(); return; }
        if (isSubmit && MOCK_FAIL === 'full') { out = { ok: false, error: 'invalid', errors: { date: '선택한 날짜는 예약이 다 찼어요. 다른 날짜를 골라 주세요.' } }; }
        else { try { out = JSON.parse(env.ctx.doPost({ postData: { contents: body } }).text); } catch (e) { out = { ok: false, error: 'server_error' }; } }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
      }, /"action":"submit"/.test(body) ? MOCK_DELAY : 0);
    });
    return;
  }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log('mock server http://localhost:' + PORT + '/apply/'));
