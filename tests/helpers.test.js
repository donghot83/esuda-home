// 2026-11-15 추가 기능 테스트 — 연도 넘김, 날짜 사이 2칸, 장부 포함 22건, 예약 취소, 매일 점검·현황판 (가상 데이터만)
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-15T01:00:00Z'; // 한국 11/15(일) 10:00
const D = s => new Date(s + 'T00:00:00+09:00');
const HEAD = [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', null];
const ledger = () => ({
  '11월 매입금액': [
    HEAD,
    [1, D('2026-11-13'), '가상A', '강남구', '가상로 1', 20],
    [],
    [null, D('2026-11-16'), '가상C', '은평구', '가상로 3'],
    [null, D('2026-11-16'), '가상D', '용산구', '가상로 4'],
    [],
    [null, D('2026-11-18'), '가상E', '고양시', '덕양구 가상로 5'],
    [],
    [null, D('2026-07-14'), '수거 양(kg)']
  ],
  '1월매입입금': [HEAD, [1, D('2026-01-05'), '작년1월', '마포구', '가상로']] // 2026년 1월 시트 (건드리면 안 됨)
});
const north = { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상로 9', zonecode: '00000' };
const sub = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12), name: '신청고객', phone: '010-0000-0000',
  address: north, addressDetail: '101호', date: '2026-11-16', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1],
  bank: '신한은행', account: '0000000000', holder: '신청고객', agreeNotice: true, agreePrivacy: true
}, over);
const names = sh => sh.rows.map(r => (r && r[2]) || '');
const book = env => { const b = env.sheet('예약').rows; return { h: b[0], rows: b, get: (i, k) => b[i][b[0].indexOf(k)] }; };

test('연도 넘김: 2027년 1월 예약은 26년 장부(1월 시트)에 절대 안 들어가고 대기 → 27년 장부를 연결하면 그쪽에 들어감', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const r = env.post(sub({ date: '2027-01-04' })); // 월요일·짝수일, 오늘부터 50일
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(book(env).get(1, '장부반영'), '대기');
  assert.deepStrictEqual(names(env.ledger['1월매입입금']), ['이름', '작년1월']); // 2026년 1월 시트 그대로
  const g27 = createEnv({ ledger: { '1월 매입금액': [HEAD] } }).ledger['1월 매입금액'];
  env.otherLedgers.L27 = { '1월 매입금액': g27 };
  env.props.LEDGER_ID_2027 = 'L27';
  assert.strictEqual(env.ctx.syncLedgerPending().added, 1);
  assert.strictEqual(names(g27)[1], '신청고객');
  assert.deepStrictEqual(names(env.ledger['1월매입입금']), ['이름', '작년1월']);
});

test('새 날짜 묶음은 앞 날짜와 빈 줄 2칸 띄움, 같은 날짜는 바로 아래', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  env.post(sub({ date: '2026-11-20', name: '스무날' }));
  const n = names(env.ledger['11월 매입금액']);
  const i = n.indexOf('스무날');
  assert.deepStrictEqual([n[i - 3], n[i - 2], n[i - 1]], ['가상E', '', ''], n.join('|'));
  assert.ok(i < n.indexOf('수거 양(kg)'));
  env.post(sub({ date: '2026-11-20', name: '스무날둘' }));
  const n2 = names(env.ledger['11월 매입금액']);
  assert.strictEqual(n2.indexOf('스무날둘'), n2.indexOf('스무날') + 1);
});

test('날짜 칸 모양은 시트에서 많이 쓰는 모양(예: 11/16(월))을 따름', () => {
  const L = ledger();
  [3, 4, 6].forEach(i => { L['11월 매입금액'][i].fmt = { 2: 'mm/dd(ddd)' }; });
  const env = createEnv({ now: NOW, ledger: L });
  env.post(sub({ date: '2026-11-16' }));
  const row = env.ledger['11월 매입금액'].rows.find(r => r && r[2] === '신청고객');
  assert.strictEqual(row.fmt[2], 'mm/dd(ddd)');
});

test('하루 22건은 장부 줄(카톡·직원 입력)까지 세서 마감', () => {
  const L = ledger();
  for (let k = 0; k < 22; k++) L['11월 매입금액'].splice(7, 0, [null, D('2026-11-18'), '카톡' + k, '은평구', '가상로']);
  const env = createEnv({ now: NOW, ledger: L });
  env.ctx.refreshLedgerCounts_();
  assert.ok(env.get({ action: 'schedule' }).counts['2026-11-18'] >= 22);
  const r = env.post(sub({ date: '2026-11-18' }));
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.date, /다 찼어요/);
  assert.strictEqual(env.post(sub({ date: '2026-11-20' })).ok, true); // 다른 날은 그대로
});

test('예약 취소: 예약 시트=취소, 장부 줄 삭제, 그날 하나뿐이면 빈 줄 2칸도 정리 → 장부가 원래대로', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const before = JSON.stringify(names(env.ledger['11월 매입금액']));
  const r = env.post(sub({ date: '2026-11-20' }));
  const c = env.ctx.cancelReservation(r.reservationId);
  assert.strictEqual(c.ok, true, c.msg);
  assert.strictEqual(book(env).get(1, '확정상태'), '취소');
  assert.strictEqual(JSON.stringify(names(env.ledger['11월 매입금액'])), before);
  // 같은 날 다른 예약이 있으면 그 줄만
  const a = env.post(sub({ date: '2026-11-16', name: '취소할분' }));
  env.ctx.cancelReservation(a.reservationId);
  assert.strictEqual(JSON.stringify(names(env.ledger['11월 매입금액'])), before);
  // 다시 취소해도 문제없음
  assert.match(env.ctx.cancelReservation(a.reservationId).msg, /이미 취소/);
});

test('예약 취소: 무게가 이미 적힌 줄은 지우지 않고 메모에 [취소]', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const r = env.post(sub({ date: '2026-11-16' }));
  const row = env.ledger['11월 매입금액'].rows.find(x => x && x[2] === '신청고객');
  row[5] = 18;
  const c = env.ctx.cancelReservation(r.reservationId);
  assert.match(c.msg, /\[취소\]/);
  assert.match(row[10], /^\[취소\] /);
});

test('매일 점검 메일: 정상 항목과 확인 필요(12월 시트 없음·2027년 장부 미연결)를 알려 주고, 연락처·계좌는 안 넣음', () => {
  const env = createEnv({ now: NOW, ledger: ledger(), notify: 'boss@example.com' });
  env.post(sub({ date: '2026-11-16', phone: '010-1111-2222', account: '1234567890' }));
  env.ctx.dailyReport();
  const m = env.mails[env.mails.length - 1];
  assert.match(m.subject, /^\[이수다 매일 점검\] 11\/15\(일\) ⚠️ 확인 필요/);
  assert.match(m.body, /홀짝 규칙: 남쪽=홀수일, 북쪽=짝수일 모두 맞음/);
  assert.match(m.body, /12월 매입금액" 시트가 아직 없어요/);
  assert.match(m.body, /2027년 예약도 받기 시작/);
  assert.ok(!/01011112222|010-1111-2222|1234567890/.test(m.body));
  const dash = env.sheet('현황').rows;
  assert.ok(dash.some(r => r && r[0] === '2026-11-16' && r[3] >= 1), '현황판에 11/16 예약 수');
});

test('매일 점검: 홀짝이 어긋난 예약이 있으면 확인 필요로 알림', () => {
  const env = createEnv({ now: NOW, ledger: ledger(), notify: 'boss@example.com' });
  env.post(sub({ date: '2026-11-16' }));
  const b = book(env); b.rows[1][b.h.indexOf('구역')] = 'south'; // 일부러 틀리게
  const chk = env.ctx.runChecks_();
  assert.ok(chk.issues.some(s => /홀짝 규칙과 다른 날짜/.test(s)), chk.issues.join('\n'));
});

test('마감 탭 구역을 한글(남쪽(홀수일))로 적어도 그 구역만 닫힘', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  env.get({ action: 'schedule' });
  env.sheet('마감').appendRow(['2026-11-20', '', '북쪽(짝수일)', '시험 마감', '']);
  const s = env.get({ action: 'schedule' });
  assert.strictEqual(s.closures[0].zone, 'north');
});

test('계좌번호 6~20자리 허용, 증권사 선택 가능', () => {
  const env = createEnv({ now: NOW });
  assert.strictEqual(env.post(sub({ account: '123456' })).ok, true);
  assert.strictEqual(env.post(sub({ account: '12345' })).ok, false);
  assert.strictEqual(env.post(sub({ account: '1'.repeat(20), bank: '토스증권' })).ok, true);
});
