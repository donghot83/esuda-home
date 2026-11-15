// 신한 다건이체 파일 만들기(Transfer.gs) 테스트 — 가상 데이터만
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-15T01:00:00Z';
const HEAD = [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', null];
const ledger = () => ({ '11월 매입금액': [HEAD, [null, '2026-11-16', '가상A', '마포구', '가상로 1'], [], [null, '2026-11-07', '수거 양(kg)']] });

const sub = (name, bank, account, over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12),
  name, phone: '010-0000-0000',
  address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상로 9', zonecode: '00000' },
  addressDetail: '101호', date: '2026-11-16', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1],
  bank, account, holder: name, agreeNotice: true, agreePrivacy: true
}, over);

// 장부에서 예약번호 줄에 무게(F)·금액(I) 적기 = 직원이 수거 후 입력한 상황
function weigh(env, rid, weight, amount) {
  const sh = env.ledger['11월 매입금액'];
  const row = sh.rows.find(r => r && String(r[10] || '').includes(rid));
  row[5] = weight; if (amount !== undefined) row[8] = amount;
}

test('무게가 적힌 예약만 이체 파일에: 은행코드·계좌(숫자만, 앞 0 보존)·금액, 15kg 미만은 무상수거, 무게 없으면 확인 필요', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const a = env.post(sub('가상갑', '신한은행', '0110-123-456789'));
  const b = env.post(sub('가상을', '카카오뱅크', '3333-01-2345678'));
  const c = env.post(sub('가상병', 'KB국민은행', '000000000000'));
  const d = env.post(sub('가상정', '토스뱅크', '1000-0000-0000'));
  weigh(env, a.reservationId, 40);              // 장부 금액 비어 있음 → 40×250 = 10,000 계산
  weigh(env, b.reservationId, 30, 7250);         // 장부 금액(I열) 그대로 7,250
  weigh(env, c.reservationId, 12);               // 15kg 미만 → 무상수거
  // d 는 무게 없음 → 확인 필요
  const r = env.ctx.makeTransferFile();
  assert.strictEqual(r.count, 2); assert.strictEqual(r.total, 17250); assert.strictEqual(r.free, 1);
  assert.strictEqual(JSON.stringify(r.skipped.map(s => s.이유)), JSON.stringify(['무게 없음']));
  const out = env.created[0];
  assert.match(out.name, /^\[신한 다건이체\] /);
  const up = out.getSheetByName('업로드용').rows;
  assert.deepEqual(JSON.parse(JSON.stringify(up[0])), ['입금은행', '입금계좌', '고객관리성명', '입금액', '출금통장표시', '입금통장표시']);
  assert.deepEqual(JSON.parse(JSON.stringify(up[1])), ['088', '0110123456789', '가상갑', '10000', '가상갑', '이수다매입']);
  assert.deepEqual(JSON.parse(JSON.stringify(up[2])), ['090', '3333012345678', '가상을', '7250', '가상을', '이수다매입']);
  const book = env.sheet('예약').rows, h = book[0];
  const st = n => book.find(x => x[h.indexOf('이름')] === n)[h.indexOf('지급상태')];
  assert.strictEqual(st('가상갑'), '이체파일생성'); assert.strictEqual(st('가상병'), '무상수거'); assert.ok(!st('가상정'));
});

test('같은 예약은 두 번 들어가지 않음 / 송금 후 입금완료 표시', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const a = env.post(sub('가상갑', '신한은행', '0110123456789'));
  weigh(env, a.reservationId, 20);
  const r1 = env.ctx.makeTransferFile();
  assert.strictEqual(r1.count, 1);
  const r2 = env.ctx.makeTransferFile();
  assert.strictEqual(r2.count, 0); assert.strictEqual(env.created.length, 1); // 새 파일 안 만듦
  const p = env.ctx.markTransferPaid(env.created[0].name);
  assert.strictEqual(p.updated, 1);
  const book = env.sheet('예약').rows, h = book[0];
  assert.strictEqual(book[1][h.indexOf('지급상태')], '입금완료');
  assert.match(String(book[1][h.indexOf('입금완료일')]), /^\d{4}-\d{2}-\d{2}$/);
});

test('미리보기(dryRun)는 파일·표시를 만들지 않음', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const a = env.post(sub('가상갑', '신한은행', '0110123456789'));
  weigh(env, a.reservationId, 40);
  const r = env.ctx.makeTransferFile({ dryRun: true });
  assert.strictEqual(r.count, 1); assert.strictEqual(env.created.length, 0);
  const book = env.sheet('예약').rows, h = book[0];
  assert.ok(!book[1][h.indexOf('지급상태')]);
});
