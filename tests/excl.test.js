// 2026-11-17 장부 '무상제외' 칸 — 칸 넣기 전·후 모두 동작하는지 (가상 데이터만)
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-17T03:00:00Z';
const D = s => new Date(s + 'T00:00:00+09:00');
// 실제 장부 머리글 모양 (A 비어 있음, K 메모 머리글 없음)
const HEAD = ['', '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', ''];
const READY = { ALIMTALK_ON: '1', SOLAPI_KEY: 'K', SOLAPI_SECRET: 'S', SOLAPI_PFID: 'PF', TPL_PAID: 'KA01TPPAID', TPL_FREE: 'KA01TPFREE', WEIGH_KEY: 'WEIGHKEY12', DRIVER_KEY: 'GOODKEY123' };
const sub = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12), name: '제외고객', phone: '010-4444-5555',
  address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상북로 7', zonecode: '00000' },
  addressDetail: '2층', date: '2026-11-16', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1],
  bank: '신한은행', account: '1231231234', holder: '제외고객', agreeNotice: true, agreePrivacy: true
}, over);

function setup() {
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD] }, props: {} });
  const a = e0.post(sub());
  const e = createEnv({ now: NOW, ledger: { '11월 매입금액': [HEAD] }, props: READY });
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  const L = e.ledger['11월 매입금액'].rows;
  e0.ledger['11월 매입금액'].rows.slice(1).forEach(r => L.push(r));
  // 직원 줄: 최종 수식 =F?-G? , 손으로 만든 다른 수식 하나
  L.push(Object.assign([2, D('2026-11-16'), '직원손님', '은평구', '가상로 1', 30, 1, '', '', '', '카톡 예약'], {}));
  L.push(Object.assign([3, D('2026-11-16'), '특이손님', '은평구', '가상로 2', 20, '', '', '', '', '카톡']));
  const r2 = L.length - 1, r3 = L.length;
  L[r2 - 1].f = { 8: '=F' + r2 + '-G' + r2, 9: '=IF(H' + r2 + '>=15,H' + r2 + '*250-G' + r2 + '*200,"무상수거")' };
  L[r3 - 1].f = { 8: '=F' + r3 + '-G' + r3 + '-2' };
  return { e, a, L, r2, r3 };
}
const q = (e, b) => e.post(Object.assign({ key: 'WEIGHKEY12', date: '2026-11-16' }, b));
const rowOf = (L, rid) => L.find(x => x && x.some && x.some(c => String(c || '').includes(rid)));

test('칸 넣기 전: 머리글로 칸을 찾아도 지금과 같음 (무상제외 넣으면 칸 없다고 알려 줌)', () => {
  const { e, a } = setup();
  const c = e.ctx.ledgerCols_(e.ledger['11월 매입금액']);
  assert.deepStrictEqual([c.excl, c.loss, c.final, c.amount, c.lossAmt, c.memo], [0, 7, 8, 9, 10, 11]);
  q(e, { action: 'weighSave', id: a.reservationId, weight: 40 });
  assert.strictEqual(q(e, { action: 'lossSave', id: a.reservationId, loss: 2, excl: 3 }).error, 'no_excl_col');
  assert.strictEqual(q(e, { action: 'lossSave', id: a.reservationId, loss: 2 }).ok, true);
});

test('칸 넣기: G 무상제외·L 메모 머리글, 최종 수식은 무게-무상제외-로스로(손으로 만든 수식은 그대로·목록), 두 번 눌러도 한 번만', () => {
  const { e, a, L, r2, r3 } = setup();
  const res = e.ctx.addExclColumn_('2026-11');
  assert.strictEqual(L[0][6], '무상제외'); assert.strictEqual(L[0][11], '메모');
  assert.strictEqual(L[0][7], '로스'); assert.strictEqual(L[0][8], '최종');
  assert.ok(res.changed >= 2, JSON.stringify(res));                        // 신청페이지 줄 + 직원 줄
  assert.strictEqual(L[r2 - 1].f[9], '=IF(F' + r2 + '="","",F' + r2 + '-N(G' + r2 + ')-N(H' + r2 + '))');
  assert.strictEqual(L[r2 - 1].f[10], '=IF(I' + r2 + '>=15,I' + r2 + '*250-H' + r2 + '*200,"무상수거")');   // 금액 수식은 시트가 자동으로 맞춤
  assert.strictEqual(L[r3 - 1].f[9], '=F' + r3 + '-H' + r3 + '-2');       // 손으로 만든 건 그대로
  assert.ok(res.odd.includes(r3 + '행'));
  const ap = rowOf(L, a.reservationId), ar = L.indexOf(ap) + 1;
  assert.match(String(ap[11]), /신청페이지/);                               // 메모는 L로
  assert.strictEqual(ap.f[9], '=IF(F' + ar + '="","",F' + ar + '-N(G' + ar + ')-N(H' + ar + '))');
  assert.strictEqual(e.ctx.addExclColumn_('2026-11').skipped, '이미 있음');
});

test('칸 넣은 뒤: 계량 화면 무상제외·로스 → 장부 G·H, 이체 금액 = (무게-제외-로스)×250 - 로스×200, 알림톡 정산 중량', () => {
  const { e, a, L } = setup();
  e.ctx.addExclColumn_('2026-11'); e.ctx.ledgerColsReset_();
  const id = a.reservationId;
  q(e, { action: 'weighSave', id, bags: 3, weight: 40 });
  assert.strictEqual(q(e, { action: 'lossSave', id, loss: 30, excl: 15 }).error, 'loss_over');
  assert.strictEqual(q(e, { action: 'lossSave', id, loss: 2, excl: 3 }).ok, true);
  const ap = rowOf(L, id);
  assert.deepStrictEqual([ap[5], ap[6], ap[7]], [40, 3, 2]);
  const it = q(e, { action: 'weighList' }).items.find(x => x.name === '제외고객');
  assert.strictEqual(it.ledgerExcl, 3); assert.strictEqual(it.ledgerLoss, 2);
  const r = e.ctx.makeTransferFile();
  assert.strictEqual(r.count, 1); assert.strictEqual(r.total, 8350);      // (40-3-2)×250 - 2×200
  const m = e.fetches.map(f => f.body.messages[0]).find(x => x.kakaoOptions.templateId === 'KA01TPPAID');
  assert.strictEqual(m.kakaoOptions.variables['#{무게}'], '35');
  const rv = e.ctx.settleReview_(['2026-11-16']).find(x => x['이름'] === '제외고객');
  assert.strictEqual(rv['무상제외'], 3);
});

test('칸 넣은 뒤에도: 새 예약은 메모를 L에, 수식은 제외 포함 / 기사님 화면·취소도 메모 칸을 제대로 찾음', () => {
  const { e, L } = setup();
  e.ctx.addExclColumn_('2026-11'); e.ctx.ledgerColsReset_();
  const b = e.post(sub({ name: '새고객', date: '2026-11-18', submissionId: 'sub-new-' + Date.now() }));
  assert.strictEqual(b.ok, true);
  const nr = rowOf(L, b.reservationId), n = L.indexOf(nr) + 1;
  assert.match(String(nr[11]), /^ESD-.* 신청페이지/);
  assert.strictEqual(nr.f[9], '=IF(F' + n + '="","",F' + n + '-N(G' + n + ')-N(H' + n + '))');
  assert.match(nr.f[10], new RegExp('IF\\(I' + n + '>=15,I' + n + '\\*250-N\\(H' + n + '\\)\\*200'));
  const dl = e.post({ action: 'driverList', key: 'GOODKEY123', date: '2026-11-18', fresh: true });
  const di = dl.items.find(x => x.name === '새고객');
  assert.strictEqual(di.rid, b.reservationId);
  const c = e.ctx.cancelReservation(b.reservationId);
  assert.strictEqual(c.ok, true);
  assert.match(String(nr[11]), /^\[취소/);
});
