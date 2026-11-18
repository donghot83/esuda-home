// 2026-11-18 카톡·직원 예약: 장부 '연락처' 칸 → 예약 등록·번호 가리기·알림톡 (가상 데이터만)
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');

const NOW = '2026-11-18T03:00:00Z';   // 11/18 12시
const D = s => new Date(s + 'T00:00:00+09:00');
const HEAD = ['', '날짜', '이름', '지역구', '주소', '무게', '무상제외', '로스', '최종', '금액', '로스금액', '메모'];
const READY = { ALIMTALK_ON: '1', SOLAPI_KEY: 'K', SOLAPI_SECRET: 'S', SOLAPI_PFID: 'PF', TPL_BOOKED: 'KA01TPBOOK', TPL_SAMEDAY: 'KA01TPSAME', TPL_PICKED: 'KA01TPPICK', DRIVER_KEY: 'GOODKEY123' };
const row = (no, d, name, area, addr, memo, phone) => { const r = [no, D(d), name, area, addr, '', '', '', '', '', '', memo]; if (phone !== undefined) r[12] = phone; return r; };

function setup() {
  const L = [HEAD.slice(), row(1, '2026-11-19', '기존손님', '은평구', '가상로 1 101호', '카톡 / 문앞')];
  const e = createEnv({ now: NOW, ledger: { '11월 매입금액': L }, props: READY });
  return { e, L: e.ledger['11월 매입금액'].rows };
}

test('연락처 칸 추가: 메모 오른쪽에 머리글, 지금 있는 카톡 예약은 기존으로', () => {
  const { e, L } = setup();
  const r = e.ctx.setupKakaoPhone();
  assert.strictEqual(L[0][12], '연락처');
  assert.strictEqual(r[0].known, 1);
  assert.strictEqual(e.ctx.setupKakaoPhone()[0].known, 0);   // 두 번 눌러도 그대로
});

test('번호 적으면: 예약 등록·메모에 예약번호·장부 번호 가림, 새 예약은 예약 완료 알림톡, 기존 예약은 예약 완료 없이', () => {
  const { e, L } = setup();
  e.ctx.setupKakaoPhone();
  L[1][12] = '010-1111-2222';                                            // 기존 예약에 번호
  L.push(row(2, '2026-11-20', '새손님', '마포구', '가상북로 5', '', 1033334444));   // 새 예약 (시트가 앞자리 0 지운 숫자)
  const n = e.ctx.kakaoIntake_(new Date('2026-11-18T03:05:00Z'));
  assert.strictEqual(n, 2);
  assert.match(String(L[1][11]), /^ESD-261119-\d{4} 카톡 \/ 카톡 \/ 문앞$/);
  assert.strictEqual(L[1][12], '010-****-2222');
  assert.strictEqual(L[2][12], '010-****-4444');
  const bk = e.sheet('예약').rows, h = bk[0];
  const nb = bk.find(x => x[h.indexOf('이름')] === '새손님');
  assert.strictEqual(String(nb[h.indexOf('연락처')]).replace(/^'/, ''), '01033334444');
  assert.strictEqual(nb[h.indexOf('출처')], '카톡·직원');
  assert.strictEqual(nb[h.indexOf('도로명주소')], '서울 마포구 가상북로 5');
  const sent = e.fetches.map(f => f.body.messages[0]);
  assert.strictEqual(sent.length, 1);                                       // 새손님만 예약 완료
  assert.strictEqual(sent[0].to, '01033334444');
  assert.strictEqual(sent[0].kakaoOptions.templateId, 'KA01TPBOOK');
  assert.strictEqual(e.ctx.kakaoIntake_(new Date('2026-11-18T03:10:00Z')), 0);   // 다시 돌아도 그대로
  assert.ok(!JSON.stringify(L).includes('1111-2222'));
});

test('등록 뒤에는 신청페이지 예약처럼: 당일 안내·기사님 화면 연락처(출처 카톡·직원)·픽업 완료', () => {
  const { e, L } = setup();
  e.ctx.setupKakaoPhone();
  L.push(row(2, '2026-11-18', '오늘손님', '은평구', '가상로 9', '', '01055556666'));
  e.ctx.kakaoIntake_(new Date('2026-11-18T03:05:00Z'));
  const before = e.fetches.length;
  e.ctx.sendSameDayNotices();
  assert.strictEqual(e.fetches.length - before, 1);
  const dl = e.post({ action: 'driverList', key: 'GOODKEY123', date: '2026-11-18', fresh: true });
  const it = dl.items.find(x => x.name === '오늘손님');
  assert.strictEqual(it.phone.replace(/^'/, ''), '01055556666'); assert.strictEqual(it.src, '카톡·직원'); assert.ok(it.rid);
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-18', id: it.id, state: '완료' });
  assert.strictEqual(e.fetches[e.fetches.length - 1].body.messages[0].kakaoOptions.templateId, 'KA01TPPICK');
});

test('번호가 이상하거나 취소된 줄·연락처 칸이 없는 장부는 건드리지 않음', () => {
  const { e, L } = setup();
  assert.strictEqual(e.ctx.kakaoIntake_(new Date('2026-11-18T03:05:00Z')), 0);   // 칸 없음
  e.ctx.setupKakaoPhone();
  L.push(row(2, '2026-11-20', '이상번호', '마포구', '가상로', '', '1234'));
  L.push(row(3, '2026-11-20', '취소손님', '마포구', '가상로', '[취소 11/18 10:00] 카톡', '01077778888'));
  assert.strictEqual(e.ctx.kakaoIntake_(new Date('2026-11-18T03:05:00Z')), 0);
  assert.strictEqual(L[2][12], '1234');
});

test('2026-11-18 카톡 예약 정산: 번호 적기 전 계량·사진도 이어지고, 이체 파일엔 없이 매입 정산 알림톡만 (템플릿 승인 전엔 보류)', () => {
  const IMG = Buffer.from('가짜').toString('base64');
  const run = props => {
    const L0 = [HEAD.slice(0, 6).concat(['무상제외'], HEAD.slice(6)), (() => { const r = [1, D('2026-11-16'), '카톡정산', '은평구', '가상로 3', '', '', '', '', '', '', '', '']; return r; })()];
    const e = createEnv({ now: NOW, ledger: { '11월 매입금액': L0 }, props: Object.assign({}, READY, { WEIGH_KEY: 'WEIGHKEY12' }, props) });
    const L = e.ledger['11월 매입금액'].rows;
    e.ctx.setupKakaoPhone();
    const id = 'K:카톡정산|가상로 3';
    assert.strictEqual(e.post({ action: 'weighSave', key: 'WEIGHKEY12', date: '2026-11-16', id, bags: 2, weight: 30, withLoss: true, loss: 1 }).ok, true);
    assert.strictEqual(e.post({ action: 'weighPhoto', key: 'WEIGHKEY12', date: '2026-11-16', id, kind: '계량', data: IMG }).ok, true);
    const memoCol = L[0].indexOf('메모'), phoneCol = L[0].indexOf('연락처');
    L[1][phoneCol] = '010-7777-8888';
    assert.strictEqual(e.ctx.kakaoIntake_(new Date('2026-11-18T03:05:00Z')), 1);   // 이틀 전 줄도 등록
    const rid = /ESD-\d{6}-[A-Z0-9]{4}/.exec(String(L[1][memoCol]))[0];
    assert.strictEqual(e.ctx.weighPhotos_(null, rid, '계량').length, 1);            // 사진이 예약번호로 이어짐
    L[1][L[0].indexOf('금액')] = 29 * 250 - 200;
    return { e, rid, r: e.ctx.makeTransferFile() };
  };
  let { e, r } = run({});
  assert.strictEqual(r.count, 0); assert.strictEqual(r.kakao, 0);
  assert.ok(r.skipped.some(s => /승인 전이라 보류/.test(s.이유)));
  assert.ok(!e.fetches.some(f => f.body && f.body.messages && f.body.messages[0].to === '01077778888'));
  ({ e, r } = run({ TPL_SETTLE: 'T_LOSS' }));
  assert.strictEqual(r.count, 0); assert.strictEqual(r.kakao, 1); assert.strictEqual(r.kakaoTotal, 7050); assert.strictEqual(r.url, '');
  const m = e.fetches.map(f => f.body && f.body.messages && f.body.messages[0]).filter(Boolean).find(x => x.to === '01077778888' && x.kakaoOptions.templateId === 'T_LOSS');
  assert.ok(m); assert.strictEqual(m.kakaoOptions.variables['#{매입금액}'], '7,050'); assert.strictEqual(m.kakaoOptions.variables['#{정산중량}'], '29');
  assert.strictEqual(e.ctx.makeTransferFile().kakao, 0);                            // 두 번 안 감
});
