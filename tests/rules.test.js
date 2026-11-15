// node --test tests/   (Node 18+ 내장 테스트, 설치 필요 없음)
const test = require('node:test');
const assert = require('node:assert');
const R = require('../assets/apply-rules.js');

const TODAY = '2026-11-14'; // 토요일
const addr = (sido, sigungu, bname) => ({ sido, sigungu, bname: bname || '', roadAddress: sido + ' ' + sigungu + ' 어딘가로 1', zonecode: '00000' });

test('주소 분류: 한강 남쪽·김포 = 홀수, 북쪽·일산 = 짝수', () => {
  assert.deepStrictEqual([R.classifyAddress(addr('서울', '강남구')).parity, R.classifyAddress(addr('서울특별시', '관악구')).parity], ['odd', 'odd']);
  assert.strictEqual(R.classifyAddress(addr('경기', '김포시')).parity, 'odd');
  assert.strictEqual(R.classifyAddress(addr('서울', '마포구')).parity, 'even');
  assert.strictEqual(R.classifyAddress(addr('경기', '고양시 일산동구')).parity, 'even');
  assert.strictEqual(R.classifyAddress(addr('경기', '고양시 일산서구')).parity, 'even');
  assert.strictEqual(R.classifyAddress(addr('경기', '고양시 덕양구')).parity, 'even');
  assert.strictEqual(R.classifyAddress(addr('경기', '고양시 덕양구')).ok, true);
});

test('주소 분류: 25개 구가 모두 등록돼 있고 남 11 · 북 14', () => {
  const seoul = Object.keys(R.ZONES).filter(k => k.startsWith('서울|'));
  assert.strictEqual(seoul.length, 25);
  assert.strictEqual(seoul.filter(k => R.ZONES[k].zone === 'south').length, 11);
});

test('주소 분류: 확인 필요 지역과 지역 밖은 예약 불가 (카톡 안내)', () => {
  const d = R.classifyAddress(addr('경기', '하남시'), { '경기|하남시': { zone: 'south', status: 'check' } });
  assert.strictEqual(d.ok, false); assert.strictEqual(d.reason, 'check');
  const o = R.classifyAddress(addr('경기', '성남시 분당구'));
  assert.strictEqual(o.ok, false); assert.strictEqual(o.reason, 'outside');
});

test('주소 분류: 동 단위 예외가 구 단위보다 우선', () => {
  const ex = { '서울|마포구|상암동': { zone: 'south', status: 'ok' } };
  assert.strictEqual(R.classifyAddress(addr('서울', '마포구', '상암동'), null, ex).parity, 'odd');
  assert.strictEqual(R.classifyAddress(addr('서울', '마포구', '합정동'), null, ex).parity, 'even');
});

test('날짜: 남쪽은 홀수일만, 북쪽은 짝수일만, 주말·지난날 닫힘', () => {
  const o = { today: TODAY };
  assert.strictEqual(R.checkDate('2026-11-17', 'south', o).open, true);   // 화 17 홀수
  assert.strictEqual(R.checkDate('2026-11-17', 'north', o).reason, 'parity');
  assert.strictEqual(R.checkDate('2026-11-18', 'north', o).open, true);   // 수 18 짝수
  assert.strictEqual(R.checkDate('2026-11-15', 'south', o).reason, 'weekend'); // 일 15 홀수지만 주말
  assert.strictEqual(R.checkDate('2026-11-10', 'north', o).reason, 'past');
  assert.strictEqual(R.checkDate('2026-12-29', 'south', o).reason, 'horizon'); // 30일 뒤까지만 달력 표시
  assert.strictEqual(R.checkDate('2026-02-30', 'south', o).reason, 'invalid');
});

test('당일 예약: 오후 5시(한국 시간) 전에는 열림, 5시부터 닫힘', () => {
  const day = '2026-11-17'; // 화, 홀수
  const at = h => new Date(Date.UTC(2026, 10, 17, h - 9, 0)); // 한국 h시
  assert.strictEqual(R.checkDate(day, 'south', { today: day, now: at(10) }).open, true);
  assert.strictEqual(R.checkDate(day, 'south', { today: day, now: at(16) }).open, true);
  assert.strictEqual(R.checkDate(day, 'south', { today: day, now: at(17) }).reason, 'cutoff');
  const v = R.validateApplication(Object.assign(good(), { date: day }), { today: day, now: at(18) });
  assert.match(v.errors.date, /오후 5시/);
});

test('하루 한도: 확정 22건이 차면 그날 자동 마감', () => {
  const o = c => ({ today: TODAY, counts: { '2026-11-17': c } });
  assert.strictEqual(R.checkDate('2026-11-17', 'south', o(21)).open, true);
  assert.strictEqual(R.checkDate('2026-11-17', 'south', o(22)).reason, 'full');
  const v = R.validateApplication(Object.assign(good(), { date: '2026-11-18' }), { today: TODAY, counts: { '2026-11-18': 22 } }); // 마포구 = 짝수일
  assert.match(v.errors.date, /다 찼어요/);
});

test('수거양: 무상수거 / 15kg 이상 / 기타(직접 입력 필수)', () => {
  assert.deepStrictEqual(R.AMOUNTS, ['15kg 미만 (무상수거)', '15kg 이상', '기타 (직접 입력)']);
  const o = { today: TODAY };
  const bad = R.validateApplication(Object.assign(good(), { amount: R.AMOUNT_OTHER, amountDetail: '' }), o);
  assert.ok(bad.errors.amountDetail);
  const ok = R.validateApplication(Object.assign(good(), { amount: R.AMOUNT_OTHER, amountDetail: '큰 이불가방 2개' }), o);
  assert.strictEqual(ok.ok, true); assert.strictEqual(ok.clean.amount, '기타: 큰 이불가방 2개');
});

test('날짜: 대표가 연 주말(openDates)은 열림', () => {
  assert.strictEqual(R.checkDate('2026-11-21', 'south', { today: TODAY, openDates: ['2026-11-21'] }).open, true);
});

test('마감: 직원이 지정한 날짜·기간·구역이 닫히고 안내 문구가 붙음', () => {
  const closures = [
    { start: '2026-11-17', message: '17일 수거 예약 마감' },
    { start: '2026-11-24', end: '2026-11-27', zone: 'north', message: '24~27일 북쪽 마감' }
  ];
  const o = { today: TODAY, closures };
  const r = R.checkDate('2026-11-17', 'south', o);
  assert.strictEqual(r.reason, 'closed'); assert.strictEqual(r.message, '17일 수거 예약 마감');
  assert.strictEqual(R.checkDate('2026-11-26', 'north', o).reason, 'closed');
  assert.strictEqual(R.checkDate('2026-11-25', 'south', o).open, true); // 남쪽은 그 기간에도 열림
});

test('달력: 오늘부터 30일 뒤까지(31일치), 열린 날은 모두 같은 홀짝', () => {
  const cal = R.calendar('south', { today: TODAY });
  assert.strictEqual(cal.length, 31);
  assert.strictEqual(cal[0].date, TODAY);
  cal.filter(d => d.open).forEach(d => assert.strictEqual(+d.date.slice(8) % 2, 1));
  assert.ok(cal.some(d => d.open));
});

test('한국 시간 기준 오늘: UTC 15:30 은 다음 날', () => {
  assert.strictEqual(R.todayKST(new Date('2026-11-14T15:30:00Z')), '2026-11-15');
  assert.strictEqual(R.todayKST(new Date('2026-11-14T14:59:00Z')), '2026-11-14');
});

const good = () => ({
  submissionId: 'test-0001-abcdef', name: '홍길동', phone: '010-1234-5678',
  address: addr('서울', '마포구', '성산동'), addressDetail: '101동 1001호', date: '2026-11-18',
  amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1], bank: '신한은행',
  account: '110-000-000000', holder: '홍길동', agreeNotice: true, agreePrivacy: true
});

test('신청 검사: 정상 신청은 통과하고 숫자만 남김', () => {
  const v = R.validateApplication(good(), { today: TODAY });
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors));
  assert.strictEqual(v.clean.phone, '01012345678'); assert.strictEqual(v.clean.account, '110000000000');
  assert.strictEqual(v.clean.zone, 'north');
});

test('신청 검사: 계좌·동의·날짜 누락은 막힘', () => {
  const p = good(); p.account = '12-3'; p.agreePrivacy = false; p.date = '2026-11-17';
  const v = R.validateApplication(p, { today: TODAY });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.account && v.errors.agreePrivacy && v.errors.date);
});

test('신청 검사: 고객이 고른 뒤 직원이 마감하면 제출 때 막힘', () => {
  const v = R.validateApplication(good(), { today: TODAY, closures: [{ start: '2026-11-18', message: '18일 마감' }] });
  assert.strictEqual(v.ok, false); assert.match(v.errors.date, /마감/);
});

test('예약번호 형식', () => {
  assert.strictEqual(R.reservationId('2026-11-18', 'K7Q2'), 'ESD-261118-K7Q2');
});
