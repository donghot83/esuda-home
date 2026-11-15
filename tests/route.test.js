// 동선 자동 짜기(Route.gs) 테스트 — 가상 주소·가상 좌표만
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');

const NOW = '2026-11-16T07:30:00Z'; // 한국 11/16(월) 16:30
const D = s => new Date(s + 'T00:00:00+09:00');
const HEAD = [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', null];
// 짝수날(11/16): 일산 → 광진 방향. 일부러 뒤죽박죽 순서로 넣음
const rows = () => [
  HEAD,
  [1, D('2026-11-13'), '지난날', '강남구', '가상로 1', 20],
  [],
  [null, D('2026-11-16'), '광진손님', '광진구', '가상광진로 1'],
  [null, D('2026-11-16'), '일산손님', '고양시', '일산동구 가상로 2'],
  [null, D('2026-11-16'), '은평손님', '은평구', '가상은평로 3'],
  [null, D('2026-11-16'), '마포손님', '마포구', '가상마포로 4'],
  [null, D('2026-11-16'), '성동손님', '성동구', '가상성동로 5'],
  [null, D('2026-11-16'), '덕양손님', '고양시', '덕양구 가상로 6'],
  [],
  [null, D('2026-11-18'), '다른날', '은평구', '가상로 7']
];
const GEO = {
  '서울 광진구 가상광진로 1': [37.540, 127.080], '경기 고양시 일산동구 가상로 2': [37.660, 126.770],
  '서울 은평구 가상은평로 3': [37.610, 126.925], '서울 마포구 가상마포로 4': [37.565, 126.905],
  '서울 성동구 가상성동로 5': [37.560, 127.040], '경기 고양시 덕양구 가상로 6': [37.635, 126.835]
};
const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const names = sh => sh.rows.filter(r => r && r[2] && r[1] && String(r[1]).length > 5 && new Date(r[1]).getTime() === D('2026-11-16').getTime()).map(r => r[0] + ':' + r[2]);

test('짝수날: 일산 쪽에서 시작해 광진 쪽으로 — 장부 줄 정렬 + 1번부터 번호, 다른 날짜는 그대로', () => {
  const env = createEnv({ now: NOW, ledger: { '11월 매입금액': rows() }, geo: GEO });
  const r = env.ctx.routeDate('2026-11-16');
  assert.strictEqual(r.ok, true, r.msg);
  eq(r.order.map(x => x.name), ['일산손님', '덕양손님', '은평손님', '마포손님', '성동손님', '광진손님']);
  assert.deepStrictEqual(names(env.ledger['11월 매입금액']), ['1:일산손님', '2:덕양손님', '3:은평손님', '4:마포손님', '5:성동손님', '6:광진손님']);
  const all = env.ledger['11월 매입금액'].rows.map(x => (x && x[2]) || '');
  assert.strictEqual(all[1], '지난날'); assert.strictEqual(all[all.length - 1], '다른날');
  assert.ok(r.km > 0);
});

test('확정 뒤에는 자동으로 다시 짜지 않음(번호=봉투 번호 고정), 강제로만 다시', () => {
  const env = createEnv({ now: NOW, ledger: { '11월 매입금액': rows() }, geo: GEO });
  env.ctx.routeDate('2026-11-16');
  const again = env.ctx.routeDate('2026-11-16');
  assert.strictEqual(again.ok, false); assert.strictEqual(again.already, true);
  assert.strictEqual(env.ctx.routeDate('2026-11-16', { force: true }).ok, true);
});

test('홀수날: 김포 쪽 → 강동 쪽, 취소 줄은 맨 뒤, 좌표 못 찾으면 구청 좌표로 넣고 "확인 필요"', () => {
  const L = [HEAD,
    [null, D('2026-11-17'), '강동손님', '강동구', '가상강동로 1'],
    [null, D('2026-11-17'), '취소손님', '양천구', '가상로 9', null, null, null, null, null, '[취소 11/16 10:00] 카톡'],
    [null, D('2026-11-17'), '김포손님', '김포시', '가상김포로 2'],
    [null, D('2026-11-17'), '모르는주소', '관악구', '어딘지모를길 3'],
    [null, D('2026-11-17'), '강서손님', '강서구', '가상강서로 4']];
  const env = createEnv({ now: NOW, ledger: { '11월 매입금액': L }, geo: {
    '서울 강동구 가상강동로 1': [37.530, 127.124], '경기 김포시 가상김포로 2': [37.615, 126.716], '서울 강서구 가상강서로 4': [37.551, 126.850] } });
  const r = env.ctx.routeDate('2026-11-17');
  eq(r.order.map(x => x.name), ['김포손님', '강서손님', '모르는주소', '강동손님', '취소손님']);
  eq(r.fallback, ['모르는주소(관악구)']);
  assert.strictEqual(env.ledger['11월 매입금액'].rows[5][2], '취소손님');
});

test('그날 줄 사이에 빈 줄이 끼어 있으면 정렬하지 않고 알려 줌', () => {
  const L = rows(); L.splice(5, 0, []);
  const env = createEnv({ now: NOW, ledger: { '11월 매입금액': L }, geo: GEO });
  const r = env.ctx.routeDate('2026-11-16');
  assert.strictEqual(r.ok, false); assert.match(r.msg, /빈 줄/);
});

test('17시 자동: 동선 확정 메일, 기사님 화면에 "동선 확정" 표시', () => {
  const env = createEnv({ now: NOW, ledger: { '11월 매입금액': rows() }, geo: GEO, notify: 'boss@example.com', props: { DRIVER_KEY: 'GOODKEY123' } });
  env.ctx.dailyRoute();
  const m = env.mails[env.mails.length - 1];
  assert.match(m.subject, /^\[이수다 동선\] 11\/16\(월\) 6곳 확정/);
  assert.match(m.body, /1\. 일산손님/); assert.match(m.body, /모래내로3길 7/);
  const d = env.post({ action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' });
  assert.match(d.route, /^동선 확정 .* 일산 → 광진$/);
  eq(d.items.map(x => x.no), [1, 2, 3, 4, 5, 6]);
});
