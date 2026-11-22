// 서버(Code.gs) 테스트 — 가짜 시트 위에서 실제 코드 실행
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-14T01:00:00Z'; // 한국 11/14(토) 10:00
const good = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12),
  name: '가상고객', phone: '010-0000-0000',
  address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상로 1', zonecode: '00000' },
  addressDetail: '101호', date: '2026-11-18', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1],
  bank: '신한은행', account: '0000000000', holder: '가상고객', agreeNotice: true, agreePrivacy: true
}, over);

test('정상 신청 → 저장과 동시에 확정, 예약번호·수거일 반환, 장부반영=대기', () => {
  const env = createEnv({ now: NOW });
  const r = env.post(good());
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.match(r.reservationId, /^ESD-261118-[A-Z0-9]{4}$/);
  const rows = env.sheet('예약').rows;
  assert.strictEqual(rows.length, 2);
  const h = rows[0];
  assert.strictEqual(rows[1][h.indexOf('확정상태')], '확정');
  assert.strictEqual(rows[1][h.indexOf('장부반영')], '대기');
  assert.strictEqual(rows[1][h.indexOf('계좌번호')], '0000000000'); // 앞자리 0 보존
});

test('같은 제출 재시도 → 예약 1건, 같은 예약번호', () => {
  const env = createEnv({ now: NOW });
  const p = good();
  const a = env.post(p), b = env.post(p);
  assert.strictEqual(a.reservationId, b.reservationId);
  assert.strictEqual(b.duplicate, true);
  assert.strictEqual(env.sheet('예약').rows.length, 2);
});

test('남쪽 주소는 짝수일 거부, 홀수일 확정 / 김포 홀수, 일산 짝수', () => {
  const env = createEnv({ now: NOW });
  const south = { sido: '서울', sigungu: '강남구', bname: '역삼동', roadAddress: '서울 강남구 가상로 2' };
  assert.strictEqual(env.post(good({ address: south, date: '2026-11-18' })).ok, false);
  assert.strictEqual(env.post(good({ address: south, date: '2026-11-17' })).ok, true);
  assert.strictEqual(env.post(good({ address: { sido: '경기', sigungu: '김포시', roadAddress: '경기 김포시 가상로 3' }, date: '2026-11-19' })).ok, true);
  assert.strictEqual(env.post(good({ address: { sido: '경기', sigungu: '고양시 일산서구', roadAddress: '경기 고양시 가상로 4' }, date: '2026-11-20' })).ok, true);
  assert.strictEqual(env.post(good({ address: { sido: '경기', sigungu: '고양시 덕양구', roadAddress: '경기 고양시 가상로 5' }, date: '2026-11-24' })).ok, true);
  assert.strictEqual(env.post(good({ address: { sido: '경기', sigungu: '고양시 덕양구', roadAddress: '경기 고양시 가상로 5' }, date: '2026-11-19' })).ok, false);
});

test('고객이 날짜를 고른 뒤 직원이 마감 → 제출 차단, 다른 날짜는 가능', () => {
  const env = createEnv({ now: NOW });
  env.get({ action: 'schedule' }); // 시트 생성
  env.sheet('마감').appendRow(['2026-11-18', '', 'all', '18일 수거 예약 마감', '']);
  const r = env.post(good({ date: '2026-11-18' }));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.error, 'invalid'); assert.match(r.errors.date, /마감/);
  assert.strictEqual(env.post(good({ date: '2026-11-20' })).ok, true);
});

test('공개 schedule 응답에는 마감 정보만 (고객 정보 없음)', () => {
  const env = createEnv({ now: NOW });
  env.post(good());
  const s = env.get({ action: 'schedule' });
  assert.strictEqual(s.ok, true); assert.strictEqual(s.today, '2026-11-14');
  assert.ok(!JSON.stringify(s).includes('가상고객'));
});

test('저장 실패 → ok:false (확정 안내 없음)', () => {
  const env = createEnv({ now: NOW });
  env.post(good()); // 시트 생성
  env.sheet('예약').failNextAppend = true;
  const r = env.post(good());
  assert.strictEqual(r.ok, false);
});

test('동시 처리 중(잠금) → busy, 저장 안 됨', () => {
  const env = createEnv({ now: NOW });
  env.setLocked(true);
  assert.strictEqual(env.post(good()).error, 'busy');
});

test('장부 반영 대기 목록: 토큰 필요, 계좌·연락처 없음, 반영 표시 후 빠짐', () => {
  const env = createEnv({ now: NOW, staffToken: 'tok' });
  const a = env.post(good()), b = env.post(good({ date: '2026-11-20' }));
  assert.strictEqual(env.post({ action: 'pending', token: 'wrong' }).error, 'forbidden');
  const p = env.post({ action: 'pending', token: 'tok' });
  assert.strictEqual(p.items.length, 2);
  assert.ok(!('계좌번호' in p.items[0]) && !('연락처' in p.items[0]));
  assert.strictEqual(env.post({ action: 'markSynced', token: 'tok', ids: [a.reservationId] }).updated, 1);
  assert.strictEqual(env.post({ action: 'markSynced', token: 'tok', ids: [a.reservationId] }).updated, 0); // 재시도해도 그대로
  const p2 = env.post({ action: 'pending', token: 'tok' });
  assert.deepStrictEqual(p2.items.map(x => x['예약번호']), [b.reservationId]);
});

test('Rules.gs 는 assets/apply-rules.js 와 같은 내용', () => {
  const fs = require('fs'), path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '../assets/apply-rules.js'), 'utf8');
  const gs = fs.readFileSync(path.join(__dirname, '../server/apps-script/Rules.gs'), 'utf8');
  assert.ok(gs.endsWith(js.replace(/\r\n/g, '\n')) || gs.endsWith(js), 'tools/sync_rules.py 를 실행하세요');
});

test('하루 한도: 같은 날 확정 22건이 차면 23번째는 거부, 달력용 예약 수 공개(숫자만)', () => {
  const env = createEnv({ now: NOW });
  for (let i = 0; i < 22; i++) assert.strictEqual(env.post(good()).ok, true);
  const r = env.post(good());
  assert.strictEqual(r.ok, false); assert.match(r.errors.date, /다 찼어요/);
  assert.strictEqual(env.sheet('예약').rows.length, 23);
  const s = env.get({ action: 'schedule' });
  assert.strictEqual(s.counts['2026-11-18'], 22);
  assert.ok(!JSON.stringify(s).includes('가상고객')); // 고객 정보는 나가지 않음
});

test('당일 예약: 서버도 한국 시간 오후 5시 이후 당일 신청을 거부', () => {
  const before = createEnv({ now: '2026-11-18T07:00:00Z' }); // 한국 16:00 (수, 짝수)
  assert.strictEqual(before.post(good()).ok, true);
  const after = createEnv({ now: '2026-11-18T08:00:00Z' });  // 한국 17:00
  const r = after.post(good());
  assert.strictEqual(r.ok, false); assert.match(r.errors.date, /오후 5시/);
});

test('화면에서 먼저 보여 준 예약번호(reservationIdHint)를 그대로 씀, 형식·날짜가 틀리거나 겹치면 새 번호', () => {
  const env = createEnv({ now: NOW });
  const a = env.post(good({ reservationIdHint: 'ESD-261118-AB12' }));
  assert.strictEqual(a.reservationId, 'ESD-261118-AB12');
  const b = env.post(good({ reservationIdHint: 'ESD-261118-AB12' }));      // 겹침
  assert.notStrictEqual(b.reservationId, 'ESD-261118-AB12');
  const c = env.post(good({ reservationIdHint: 'ESD-261120-ZZ99' }));      // 날짜 다름
  assert.match(c.reservationId, /^ESD-261118-/); assert.notStrictEqual(c.reservationId, 'ESD-261120-ZZ99');
  const d = env.post(good({ reservationIdHint: '<script>' }));
  assert.match(d.reservationId, /^ESD-261118-[A-Z0-9]{4}$/);
});
