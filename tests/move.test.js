// 2026-11-23 예약 날짜 바꾸기 테스트 (가상 데이터만)
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-15T01:00:00Z'; // 한국 11/15(일) 10:00
const D = s => new Date(s + 'T00:00:00+09:00');
const HEAD = [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', '메모'];
const ledger = () => ({
  '11월 매입금액': [
    HEAD,
    [null, D('2026-11-16'), '가상C', '은평구', '가상로 3'],
    [null, D('2026-11-16'), '가상D', '용산구', '가상로 4'],
    [],
    [],
    [null, D('2026-11-18'), '가상E', '고양시', '덕양구 가상로 5'],
    [],
    [],
    [null, D('2026-11-20'), '가상F', '강남구', '가상로 6'],
    [],
    [null, D('2026-07-14'), '수거 양(kg)']
  ]
});
const north = { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상로 9', zonecode: '00000' };
const sub = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12), name: '신청고객', phone: '010-0000-0000',
  address: north, addressDetail: '101호', date: '2026-11-16', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1],
  bank: '신한은행', account: '0000000000', holder: '신청고객', agreeNotice: true, agreePrivacy: true
}, over);
const ymd = d => d instanceof Date ? new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10) : String(d);
const rowsOf = env => env.ledger['11월 매입금액'].rows;
const rowBy = (env, name) => rowsOf(env).find(x => x && x[2] === name);

test('신청페이지 예약 날짜 바꾸기: 장부 줄이 새 날짜 묶음 끝으로, 메모에 날짜변경, 예약 시트 수거일, 두 날짜 번호 다시', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const r = env.post(sub({ date: '2026-11-16', name: '옮길분' }));
  assert.ok(r.ok);
  env.ctx.renumberUpcoming();
  const m = env.ctx.moveReservation(R.shortId(r.reservationId), '11/18');
  assert.strictEqual(m.ok, true, m.msg);
  const names = rowsOf(env).map(x => (x && x[2]) || '');
  assert.strictEqual(names.indexOf('옮길분'), names.indexOf('가상E') + 1, names.join('|'));
  const row = rowBy(env, '옮길분');
  assert.strictEqual(ymd(row[1]), '2026-11-18');
  assert.strictEqual(row[0], 2);
  assert.match(row[10], /^ESD-\S+ 신청페이지 \/ .* \/ 날짜변경 11\/16→11\/18$/);
  assert.match(String((row.f || {})[8] || ''), /^=IF\(F/);           // 수식도 새 줄에
  assert.deepStrictEqual([rowBy(env, '가상C')[0], rowBy(env, '가상D')[0]], [1, 2]);
  const b = env.sheet('예약').rows, h = b[0];
  assert.strictEqual(ymd(b.find(x => x[0] === r.reservationId)[h.indexOf('수거일')]), '2026-11-18');
  // 바뀐 뒤에도 예약번호로 찾기·취소가 새 날짜로 됨
  assert.strictEqual(env.ctx.parseCancelInput_(r.reservationId).date, '2026-11-18');
  const c = env.ctx.cancelReservation(r.reservationId);
  assert.strictEqual(c.ok, true); assert.match(c.msg, /11\/18 2번 옮길분/);
});

test('카톡 예약(예약번호 없음)은 날짜+번호로, 그날 마지막 줄이면 빈 줄 간격도 정리', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  env.ctx.renumberUpcoming();
  const before = rowsOf(env).length;
  const m = env.ctx.moveReservation('11/18 1', '11/20');
  assert.strictEqual(m.ok, true, m.msg);
  assert.match(m.msg, /장부만 옮겼어요/);
  const names = rowsOf(env).map(x => (x && x[2]) || '');
  assert.deepStrictEqual(names.slice(0, 7), ['이름', '가상C', '가상D', '', '', '가상F', '가상E'], names.join('|'));
  assert.strictEqual(rowsOf(env).length, before - 2);
  assert.strictEqual(rowBy(env, '가상E')[0], 2);
});

test('옮기지 않는 경우: 무게 적힘·취소됨·지난 날짜·같은 날짜·이상한 입력', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  env.ctx.renumberUpcoming();
  rowBy(env, '가상C')[5] = 22;
  assert.match(env.ctx.moveReservation('11/16 1', '11/18').msg, /무게가 이미/);
  const r = env.post(sub({ date: '2026-11-16', name: '취소분' }));
  env.ctx.cancelReservation(r.reservationId);
  assert.match(env.ctx.moveReservation(r.reservationId, '11/18').msg, /취소된/);
  assert.match(env.ctx.moveReservation('11/16 2', '11/10').msg, /지난 날짜/);
  assert.match(env.ctx.moveReservation('11/16 2', '11/16').msg, /이미 그 날짜/);
  assert.strictEqual(env.ctx.moveReservation('아무거나', '11/18').ok, false);
  assert.strictEqual(env.ctx.moveReservation('11/16 2', '내일').ok, false);
});
