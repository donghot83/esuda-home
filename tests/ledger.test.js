// 장부 자동 입력(Ledger.gs) 테스트 — 현행 장부 '11월 매입금액' 모양을 흉내 낸 가짜 시트 (가상 데이터만)
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-15T01:00:00Z'; // 한국 11/15(일) 10:00
const D = s => new Date(s + 'T00:00:00+09:00');
const HEAD = [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', null];

// 수거 끝난 줄(11/13) + 빈 줄 + 예약 칸(11/16 2건, 빈 줄, 11/18 1건) + 아래 월별 요약표(다른 달 날짜)
const ledger = () => ({
  '11월 매입금액': [
    HEAD,
    [1, D('2026-11-13'), '가상A', '강남구', '가상로 1', 20],
    [2, D('2026-11-13'), '가상B', '송파구', '가상로 2', 30],
    [],
    [null, D('2026-11-16'), '가상C', '은평구', '가상로 3'],
    [null, D('2026-11-16'), '가상D', '용산구', '가상로 4'],
    [],
    [null, D('2026-11-18'), '가상E', '고양시', '덕양구 가상로 5'],
    [],
    [null, D('2026-07-14'), '수거 양(kg)', '매입금액'],
    [null, '10월', 40, '=C11*400']
  ]
});

const sub = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12),
  name: '신청고객', phone: '010-0000-0000',
  address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상북로 233', zonecode: '00000' },
  addressDetail: '22동 906호', date: '2026-11-16', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[0], entranceCode: '#1234#',
  memo: '문 앞에 둘게요', bank: '신한은행', account: '0000000000', holder: '신청고객', agreeNotice: true, agreePrivacy: true
}, over);

const names = sh => sh.rows.map(r => (r && r[2]) || '');
const ymd = v => v instanceof Date || Object.prototype.toString.call(v) === '[object Date]'
  ? new Date(v.getTime() + 9 * 3600e3).toISOString().slice(0, 10) : v;

test('같은 날짜 묶음 끝에 붙고, 날짜·이름·지역구·주소·메모(예약번호)만 들어감', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const r = env.post(sub());
  assert.strictEqual(r.ok, true);
  const sh = env.ledger['11월 매입금액'];
  const i = names(sh).indexOf('신청고객');
  assert.strictEqual(i, 6, names(sh).join('|'));            // 가상D(5) 바로 다음
  const row = sh.rows[i];
  assert.strictEqual(ymd(row[1]), '2026-11-16');
  assert.strictEqual(row[3], '마포구');
  assert.strictEqual(row[4], '가상북로 233 22동 906호');
  assert.match(row[10], new RegExp('^' + r.reservationId + ' 신청페이지 / 15kg 이상 / 문 앞에 둘게요$'));
  const all = JSON.stringify(sh.rows);
  assert.ok(!all.includes('010-0000-0000') && !all.includes('0000000000') && !all.includes('#1234#')); // 연락처·계좌·비번 없음
  assert.strictEqual(names(sh)[8], '가상E');                   // 뒤 날짜는 한 줄씩 밀림
  const b = env.sheet('예약').rows; assert.strictEqual(b[1][b[0].indexOf('장부반영')], '완료');
});

test('새 날짜(11/17)는 앞 날짜 묶음 뒤 빈 줄 다음에, 11/18 앞에 들어감 (고양시는 시/구 나눠 적기)', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const r = env.post(sub({ date: '2026-11-17', address: { sido: '서울', sigungu: '강남구', bname: '역삼동', roadAddress: '서울 강남구 가상로 110' }, addressDetail: '705호' }));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const env2 = createEnv({ now: NOW, ledger: ledger() });
  env2.post(sub({ date: '2026-11-20', address: { sido: '경기', sigungu: '고양시 덕양구', bname: '화정동', roadAddress: '경기 고양시 덕양구 가상로 32-9' }, addressDetail: 'A동 1702호' }));
  const sh = env.ledger['11월 매입금액'];
  const n = names(sh);
  const i = n.indexOf('신청고객');
  assert.ok(i > n.indexOf('가상D') + 1 && i < n.indexOf('가상E'), n.join('|'));
  assert.strictEqual(String(n[i - 1]), '');                   // 날짜 사이 빈 줄 유지
  const g = env2.ledger['11월 매입금액'].rows.find(r => r && r[2] === '신청고객');
  assert.strictEqual(g[3], '고양시'); assert.strictEqual(g[4], '덕양구 가상로 32-9 A동 1702호');
  assert.ok(env2.ledger['11월 매입금액'].rows.findIndex(r => r && r[2] === '신청고객') < env2.ledger['11월 매입금액'].rows.findIndex(r => r && r[2] === '수거 양(kg)')); // 요약표 위
});

test('해당 달 시트가 없으면(12월) 예약은 확정, 장부반영=대기 → 시트가 생긴 뒤 syncLedgerPending 이 넣음, 다시 돌려도 1번만', () => {
  const env = createEnv({ now: NOW, ledger: ledger() });
  const r = env.post(sub({ date: '2026-12-02' }));
  assert.strictEqual(r.ok, true);
  const b = env.sheet('예약').rows; assert.strictEqual(b[1][b[0].indexOf('장부반영')], '대기');
  // 12월 시트 생성(머리글만)
  const grid = createEnv({ ledger: { '12월 매입금액': [HEAD] } }).ledger['12월 매입금액'];
  env.ledger['12월 매입금액'] = grid;
  const s1 = env.ctx.syncLedgerPending();
  assert.strictEqual(s1.added, 1);
  assert.strictEqual(names(grid)[1], '신청고객');
  const s2 = env.ctx.syncLedgerPending();
  assert.strictEqual(s2.added, 0);
  assert.strictEqual(names(grid).filter(x => x === '신청고객').length, 1);
});

test('장부를 열 수 없어도 고객 예약은 확정, 장부반영=대기', () => {
  const env = createEnv({ now: NOW, ledgerFail: true });
  const r = env.post(sub());
  assert.strictEqual(r.ok, true);
  const b = env.sheet('예약').rows; assert.strictEqual(b[1][b[0].indexOf('장부반영')], '대기');
});

test('장부 ID가 설정되지 않으면 장부 입력은 건너뜀(기존 동작 그대로)', () => {
  const env = createEnv({ now: NOW });
  assert.strictEqual(env.post(sub()).ok, true);
  const b = env.sheet('예약').rows; assert.strictEqual(b[1][b[0].indexOf('장부반영')], '대기');
});

test('장부 시간대가 GMT여도(구글로 가져온 파일) 날짜가 하루 밀리지 않음 — 2026-11-15 실제 시험 버그 재현', () => {
  const G = s => new Date(s + 'T00:00:00Z'); // GMT 시트의 날짜 칸 = 그날 GMT 0시
  const env = createEnv({ now: NOW, ledgerTz: 'GMT', ledger: { '11월 매입금액': [
    HEAD,
    [null, G('2026-11-17'), '가상X', '강남구', '가상로 9'],
    [],
    [null, G('2026-11-18'), '가상Y', '고양시', '덕양구 가상로 8'],
    [],
    [null, G('2026-07-14'), '수거 양(kg)']
  ] } });
  assert.strictEqual(env.post(sub({ date: '2026-11-18' })).ok, true);
  const sh = env.ledger['11월 매입금액'];
  const i = names(sh).indexOf('신청고객');
  assert.strictEqual(i, 4, names(sh).join('|'));                 // 11/18 묶음(가상Y) 바로 아래
  assert.strictEqual(sh.rows[i][1], '2026-11-18'); // 날짜는 글자로 넣어 시트가 그날로 해석
});

test('장부 왼쪽 번호: 그날 줄을 1, 2, 3 … 으로 매기고, 취소해도 번호 유지 (지난 날짜는 안 건드림)', () => {
  const L = ledger();
  const env = createEnv({ now: NOW, ledger: L });
  const a = env.post(sub({ date: '2026-11-16', name: '셋째' }));
  env.post(sub({ date: '2026-11-16', name: '넷째' }));
  const sh = env.ledger['11월 매입금액'];
  const nums = () => sh.rows.filter(r => r && r[2] && ymd(r[1]) === '2026-11-16').map(r => r[0] + ':' + r[2]);
  assert.deepStrictEqual(nums(), ['1:가상C', '2:가상D', '3:셋째', '4:넷째']);
  env.ctx.cancelReservation(a.reservationId);
  assert.deepStrictEqual(nums(), ['1:가상C', '2:가상D', '3:셋째', '4:넷째']); // 취소해도 번호(봉투 번호) 그대로
  assert.strictEqual(sh.rows[1][0], 1); assert.strictEqual(sh.rows[2][0], 2); // 11/13 기존 번호 그대로
});
