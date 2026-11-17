// 기사님 화면(Driver.gs) 테스트 — 가상 데이터만
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-16T03:00:00Z'; // 한국 11/16(월) 12:00
const D = s => new Date(s + 'T00:00:00+09:00');
const HEAD = [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', null];
const ledger = () => ({ '11월 매입금액': [
  HEAD,
  [null, D('2026-11-16'), '가상카톡', '고양시', '덕양구 가상로 5', null, null, null, null, null, '카톡 / 이불 2개'],
  [null, D('2026-11-16'), '가상취소', '은평구', '가상로 7', null, null, null, null, null, '[취소] 메모'],
  [],
  [null, D('2026-11-17'), '다른날', '강남구', '가상로 1']
] });
const sub = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12), name: '신청고객', phone: '010-0000-1111',
  address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상북로 233', zonecode: '00000' },
  addressDetail: '22동 906호', date: '2026-11-18', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[0], entranceCode: '#7788#',
  memo: '경비실 옆', bank: '신한은행', account: '1112223334', holder: '신청고객', agreeNotice: true, agreePrivacy: true
}, over);
const post = (env, b) => env.post(b);

test('코드가 없거나 틀리면 목록을 주지 않음', () => {
  const env = createEnv({ now: NOW, ledger: ledger(), props: { DRIVER_KEY: 'GOODKEY123' } });
  assert.strictEqual(post(env, { action: 'driverList', key: 'WRONG' }).error, 'forbidden');
  assert.strictEqual(post(env, { action: 'driverList' }).error, 'forbidden');
  const env2 = createEnv({ now: NOW, ledger: ledger() }); // 코드 설정 전
  assert.strictEqual(post(env2, { action: 'driverList', key: '' }).error, 'forbidden');
});

test('그날 장부 줄(카톡 포함) + 신청페이지 예약은 연락처·공동현관 비번까지, 계좌는 절대 안 보냄, [취소]·취소예약은 빠짐', () => {
  const env = createEnv({ now: NOW, ledger: ledger(), props: { DRIVER_KEY: 'GOODKEY123' } });
  const a = post(env, sub()); const c = post(env, sub({ name: '취소손님', submissionId: 'sub-cancel-1' }));
  env.ctx.cancelReservation(c.reservationId);
  const r = post(env, { action: 'driverList', key: 'goodkey123', date: '2026-11-18' }); // 소문자도 됨
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items.length, 2);
  const cx = r.items.find(x => x.name === '취소손님');
  assert.strictEqual(cx.cancelled, true); assert.strictEqual(cx.phone, undefined); assert.strictEqual(cx.entrance, undefined);
  const it = r.items.find(x => x.name === '신청고객');
  assert.strictEqual(it.rid, a.reservationId);
  assert.strictEqual(it.phone, '01000001111');
  assert.match(it.entrance, /#7788#/);
  assert.strictEqual(it.request, '경비실 옆');
  assert.strictEqual(it.map, '서울 마포구 가상북로 233');
  assert.ok(!JSON.stringify(r).includes('1112223334'), '계좌번호 없음');
  const k = post(env, { action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' });
  assert.deepStrictEqual(k.items.map(x => x.name + (x.cancelled ? '(취소)' : '')), ['가상카톡', '가상취소(취소)']);
  assert.strictEqual(k.items[0].map, '경기 고양시 덕양구 가상로 5');
  assert.strictEqual(k.items[0].src, '카톡·직원');
});

test('날짜를 안 주면 오늘, 새벽 6시 전이면 전날 목록', () => {
  const env = createEnv({ now: '2026-11-16T18:30:00Z', ledger: ledger(), props: { DRIVER_KEY: 'GOODKEY123' } }); // 한국 11/17 03:30
  assert.strictEqual(post(env, { action: 'driverList', key: 'GOODKEY123' }).date, '2026-11-16');
  const env2 = createEnv({ now: NOW, ledger: ledger(), props: { DRIVER_KEY: 'GOODKEY123' } });
  assert.strictEqual(post(env2, { action: 'driverList', key: 'GOODKEY123' }).date, '2026-11-16');
});

test('수거 완료 체크 → 다시 불러와도 유지, 되돌리기 가능, 점검 메일에 어제 완료 수', () => {
  const env = createEnv({ now: NOW, ledger: ledger(), props: { DRIVER_KEY: 'GOODKEY123' }, notify: 'boss@example.com' });
  const id = post(env, { action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' }).items[0].id;
  assert.strictEqual(post(env, { action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id, name: '가상카톡', state: '완료' }).ok, true);
  assert.strictEqual(post(env, { action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' }).items[0].state, '완료');
  post(env, { action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id, state: '' });
  assert.strictEqual(post(env, { action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' }).items[0].state, '되돌림');
  assert.strictEqual(post(env, { action: 'driverMark', key: 'BAD', date: '2026-11-16', id, state: '완료' }).error, 'forbidden');
  assert.strictEqual(post(env, { action: 'driverMark', key: 'GOODKEY123', date: 'x', id, state: '완료' }).error, 'bad_request');
});

test('기사님 지도: 좌표와 출발지, 확정 전엔 동선 미리보기 순서(pv), 확정 후엔 미리보기 없음', () => {
  const geo = { '경기 고양시 덕양구 가상로 5': [37.635, 126.835], '서울 은평구 가상로 7': [37.61, 126.925], '서울 모래내로3길 7': [37.5649, 126.905] };
  const L = { '11월 매입금액': [HEAD,
    [null, D('2026-11-16'), '은평손님', '은평구', '가상로 7'],
    [null, D('2026-11-16'), '덕양손님', '고양시', '덕양구 가상로 5']] };
  const env = createEnv({ now: NOW, ledger: L, geo, props: { DRIVER_KEY: 'GOODKEY123' } });
  const r = post(env, { action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' });
  assert.strictEqual(r.preview, true);
  assert.strictEqual(r.start.lat, 37.5649);
  const by = n => r.items.find(x => x.name === n);
  assert.strictEqual(by('덕양손님').pv, 1); assert.strictEqual(by('은평손님').pv, 2); // 일산·덕양 쪽부터
  assert.strictEqual(by('은평손님').lat, 37.61);
  env.ctx.routeDate('2026-11-16');
  const r2 = post(env, { action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' });
  assert.strictEqual(r2.preview, false);
  assert.strictEqual(JSON.stringify(r2.items.map(x => x.no + x.name)), JSON.stringify(['1덕양손님', '2은평손님']));
});

test('2026-11-17 속도: 목록 1분 캐시 — 다시 열면 캐시, 새로고침(fresh)·완료 누름 뒤엔 새로 만듦', () => {
  const L = { '11월 매입금액': [HEAD, [null, D('2026-11-16'), '캐시손님', '은평구', '가상로 7']] };
  const env = createEnv({ now: NOW, ledger: L, props: { DRIVER_KEY: 'GOODKEY123' } });
  const q = o => post(env, Object.assign({ action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' }, o));
  assert.ok(!q().cached);
  assert.strictEqual(q().cached, true);
  env.ledger['11월 매입금액'].rows.push([null, D('2026-11-16'), '새손님', '마포구', '가상로 9']);
  assert.strictEqual(q().items.length, 1);              // 캐시(1분 안)
  assert.strictEqual(q({ fresh: true }).items.length, 2); // 새로고침은 최신
  const id = q().items[0].id;
  post(env, { action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id, state: '완료' });
  const r = q();
  assert.ok(!r.cached); assert.strictEqual(r.items.find(x => x.id === id).state, '완료');
  assert.strictEqual(q({ key: 'BAD' }).error, 'forbidden');   // 캐시가 있어도 코드 확인 먼저
});
