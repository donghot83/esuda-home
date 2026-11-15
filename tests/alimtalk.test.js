// 알림톡(솔라피) 테스트 — 실제 발송 없음(가짜 UrlFetchApp), 가상 데이터만
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-16T03:00:00Z';
const D = s => new Date(s + 'T00:00:00+09:00');
const HEAD = [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', null];
const READY = { ALIMTALK_ON: '1', SOLAPI_KEY: 'TESTKEY', SOLAPI_SECRET: 'testsecret', SOLAPI_PFID: 'KA01PFTEST', SOLAPI_FROM: '01000000000',
  TPL_BOOKED: 'KA01TPBOOK', TPL_PICKED: 'KA01TPPICK', TPL_PAID: 'KA01TPPAID', TPL_FREE: 'KA01TPFREE', DRIVER_KEY: 'GOODKEY123' };
const sub = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12), name: '신청고객', phone: '010-1234-5678',
  address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상북로 233', zonecode: '00000' },
  addressDetail: '101호', date: '2026-11-18', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1],
  bank: '신한은행', account: '1112223334', holder: '신청고객', agreeNotice: true, agreePrivacy: true
}, over);
const env = (props, more = {}) => createEnv(Object.assign({ now: NOW, ledger: { '11월 매입금액': [HEAD] }, props }, more));

test('스위치가 꺼져 있거나 키가 없으면 아무것도 안 보냄 (예약은 정상)', () => {
  const e1 = env({}); assert.strictEqual(e1.post(sub()).ok, true); assert.strictEqual(e1.fetches.length, 0);
  const e2 = env({ ALIMTALK_ON: '1' }); assert.strictEqual(e2.post(sub()).ok, true); assert.strictEqual(e2.fetches.length, 0);
});

test('예약 완료 알림톡: 솔라피 형식(HMAC 서명·pfId·템플릿·변수), 기록엔 번호 뒷4자리만', () => {
  const e = env(READY);
  const r = e.post(sub());
  assert.strictEqual(e.fetches.length, 1);
  const f = e.fetches[0];
  assert.strictEqual(f.url, 'https://api.solapi.com/messages/v4/send-many/detail');
  const m = f.body.messages[0];
  assert.strictEqual(m.to, '01012345678');
  assert.strictEqual(m.from, '01000000000');
  assert.deepStrictEqual([m.kakaoOptions.pfId, m.kakaoOptions.templateId], ['KA01PFTEST', 'KA01TPBOOK']);
  assert.strictEqual(m.kakaoOptions.variables['#{예약번호}'], r.reservationId);
  assert.strictEqual(m.kakaoOptions.variables['#{수거일}'], '11/18(수)');
  assert.strictEqual(m.kakaoOptions.variables['#{주소}'], '서울 마포구 가상북로 233 101호');
  const a = /^HMAC-SHA256 apiKey=TESTKEY, date=(\S+), salt=(\w+), signature=([0-9a-f]{64})$/.exec(f.o.headers.Authorization);
  assert.ok(a, f.o.headers.Authorization);
  assert.strictEqual(a[3], crypto.createHmac('sha256', 'testsecret').update(a[1] + a[2]).digest('hex'));
  const log = e.sheet('알림톡기록').rows[1];
  assert.deepStrictEqual([log[1], log[2], log[3], log[4]], ['예약 완료', r.reservationId, '****5678', '성공']);
  assert.ok(!JSON.stringify(e.sheet('알림톡기록').rows).includes('01012345678'));
});

test('픽업 완료: 기사님 [수거 완료] 처음 누를 때만 1번, 카톡 예약(연락처 없음)은 안 보냄', () => {
  const e = env(READY);
  const r = e.post(sub({ date: '2026-11-16' }));
  e.ledger['11월 매입금액'].rows.push([null, D('2026-11-16'), '카톡손님', '은평구', '가상로']);
  const before = e.fetches.length;
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, state: '완료' });
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, state: '' });
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, state: '완료' });
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: 'K:카톡손님|가상로', state: '완료' });
  assert.strictEqual(e.fetches.length - before, 1);
  assert.strictEqual(e.fetches[e.fetches.length - 1].body.messages[0].kakaoOptions.templateId, 'KA01TPPICK');
});

test('발송 실패해도 예약은 확정, 기록에 실패 사유', () => {
  const e = env(READY, { fetchReply: { code: 400, body: { errorMessage: '템플릿 없음' } } });
  assert.strictEqual(e.post(sub()).ok, true);
  assert.match(e.sheet('알림톡기록').rows[1][4], /^실패 400 템플릿 없음/);
});

test('입금 완료·무상수거 알림톡: 이체 파일 흐름에 맞춰 보냄 (계좌는 끝 4자리만)', () => {
  const e = env(READY);
  const a = e.post(sub({ date: '2026-11-16', name: '입금손님', account: '9998887776' }));
  const b = e.post(sub({ date: '2026-11-16', name: '무상손님' }));
  const L = e.ledger['11월 매입금액'].rows;
  L.find(x => x && x[2] === '입금손님')[5] = 40;
  L.find(x => x && x[2] === '무상손님')[5] = 10;
  const res = e.ctx.makeTransferFile();
  assert.strictEqual(res.count, 1); assert.strictEqual(res.free, 1);
  const free = e.fetches.find(f => f.body.messages[0].kakaoOptions.templateId === 'KA01TPFREE');
  assert.strictEqual(free.body.messages[0].kakaoOptions.variables['#{무게}'], '10');
  const file = e.sheet('예약').rows.find(x => x && x[0] === a.reservationId)[e.sheet('예약').rows[0].indexOf('이체파일')];
  e.ctx.markTransferPaid(file);
  const paid = e.fetches.find(f => f.body.messages[0].kakaoOptions.templateId === 'KA01TPPAID');
  const v = paid.body.messages[0].kakaoOptions.variables;
  assert.strictEqual(v['#{금액}'], '10,000'); assert.strictEqual(v['#{계좌끝4자리}'], '7776'); assert.strictEqual(v['#{이름}'], '입금손님');
  assert.ok(!JSON.stringify(paid.body).includes('9998887776'));
});

test('점검 메일에 알림톡 준비 상태(꺼짐·남은 것)', () => {
  const e = env({}, { notify: 'boss@example.com' });
  e.ctx.dailyReport();
  assert.match(e.mails[e.mails.length - 1].body, /알림톡: 꺼짐 \(준비 남음: API 키/);
});
