// 계량 화면(Weigh.gs) 테스트 — 가상 데이터만
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-17T03:00:00Z'; // 11/17 12시
const D = s => new Date(s + 'T00:00:00+09:00');
const HEAD = [null, '날짜', '이름', '지역구', '주소', '무게', '로스', '최종', '금액', '로스금액', null];
const READY = { ALIMTALK_ON: '1', SOLAPI_KEY: 'K', SOLAPI_SECRET: 'S', SOLAPI_PFID: 'PF', TPL_PAID: 'KA01TPPAID', TPL_PAID_PHOTO: 'KA01TPPAIDPHOTO', TPL_FREE: 'KA01TPFREE',
  WEIGH_KEY: 'WEIGHKEY12', DRIVER_KEY: 'GOODKEY123' };
const sub = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12), name: '계량고객', phone: '010-2222-3333',
  address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상북로 9', zonecode: '00000' },
  addressDetail: '1층', date: '2026-11-18', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1],
  bank: '신한은행', account: '9998887776', holder: '계량고객', agreeNotice: true, agreePrivacy: true
}, over);
const IMG = Buffer.from('가짜사진').toString('base64');

// 11/16 수거분: 장부에 신청페이지 1명 + 카톡 1명(무게는 직원이 이미 적음)
function setup(props = READY) {
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD] }, props: {} });
  const a = e0.post(sub({ date: '2026-11-16' }));
  const e = createEnv({ now: NOW, ledger: { '11월 매입금액': [HEAD] }, props });
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  const L = e.ledger['11월 매입금액'].rows;
  L.push(...e0.ledger['11월 매입금액'].rows.slice(1));
  L.push([2, D('2026-11-16'), '카톡손님', '은평구', '가상로 7', 30, null, null, null, null, '카톡 예약']);
  return { e, a, L };
}
const q = (e, b) => e.post(Object.assign({ key: 'WEIGHKEY12', date: '2026-11-16' }, b));
const rowOf = (L, rid) => L.find(x => x && String(x[10] || '').includes(rid));

test('계량 코드 없으면 거절, 목록엔 장부 무게, 연락처·주소·계좌 없음, 기본 날짜 = 어제', () => {
  const { e, a } = setup();
  assert.strictEqual(e.post({ action: 'weighList', key: 'BAD' }).error, 'forbidden');
  assert.strictEqual(e.post({ action: 'weighList', key: 'GOODKEY123' }).error, 'forbidden'); // 기사님 코드로는 안 됨
  const r = q(e, { action: 'weighList' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.items.length, 2);
  const k = r.items.find(x => x.name === '카톡손님');
  assert.strictEqual(k.ledgerWeight, 30); assert.strictEqual(k.weighed, false);
  assert.strictEqual(r.items.find(x => x.name === '계량고객').rid, R.shortId(a.reservationId));
  assert.ok(!/010|가상북로|9998887776/.test(JSON.stringify(r)));
  assert.strictEqual(e.post({ action: 'weighList', key: 'WEIGHKEY12' }).date, '2026-11-16');
});

test('계량 저장: 장부 무게 칸에 기록, 장부 값과 다르면 먼저 물어봄(force 때만 덮어씀), 봉지 수 기록', () => {
  const { e, a, L } = setup();
  const id = a.reservationId;
  assert.strictEqual(q(e, { action: 'weighSave', id, bags: 3, weight: '42.5' }).ok, true);
  assert.strictEqual(rowOf(L, id)[5], 42.5);
  const k = q(e, { action: 'weighList' }).items.find(x => x.name === '카톡손님');
  const mm = q(e, { action: 'weighSave', id: k.id, bags: 2, weight: 28 });
  assert.strictEqual(mm.error, 'mismatch'); assert.strictEqual(mm.ledger, 30);
  assert.strictEqual(L.find(x => x && x[2] === '카톡손님')[5], 30);
  assert.strictEqual(q(e, { action: 'weighSave', id: k.id, bags: 2, weight: 30 }).ok, true);
  assert.strictEqual(q(e, { action: 'weighSave', id: k.id, bags: 2, weight: 28, force: true }).changed, true);
  assert.strictEqual(L.find(x => x && x[2] === '카톡손님')[5], 28);
  const it = q(e, { action: 'weighList' }).items.find(x => x.name === '계량고객');
  assert.strictEqual(it.bags, 3); assert.strictEqual(it.weighed, true); assert.strictEqual(it.lossDone, false);
  assert.strictEqual(q(e, { action: 'weighSave', id, weight: 0 }).error, 'bad_weight');
});

test('사진: 계량·로스 따로 저장(드라이브 이름 = 날짜 번호-봉지 이름), 지우기, 고객 사진 페이지엔 계량·로스 사진', () => {
  const { e, a } = setup();
  const id = a.reservationId;
  q(e, { action: 'weighSave', id, bags: 3, weight: 40 });
  const p1 = q(e, { action: 'weighPhoto', id, kind: '계량', data: IMG });
  q(e, { action: 'weighPhoto', id, kind: '계량', data: IMG });
  q(e, { action: 'weighPhoto', id, kind: '로스', data: IMG });
  assert.strictEqual(p1.ok, true);
  const names = e.drive.files.filter(f => !f.trashed).map(f => f.name);
  assert.ok(names.some(n => /^2026-11-16 \d+-3 계량고객 계량1\.jpg$/.test(n)), names.join(','));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(q(e, { action: 'weighList' }).items.find(x => x.name === '계량고객').photos)), { 계량: 2, 로스: 1 });
  assert.strictEqual(q(e, { action: 'weighPhotoDel', fileId: p1.fileId }).ok, true);
  assert.strictEqual(q(e, { action: 'weighThumbs', id }).photos.length, 2);
  q(e, { action: 'lossSave', id, loss: 2 });
  const code = e.ctx.pickPhotoCode_(id, false);
  const pg = e.post({ action: 'pickupPhoto', code });
  assert.strictEqual(pg.weigh.length, 1); assert.strictEqual(pg.loss.length, 1); assert.strictEqual(pg.lossKg, 2);
  assert.ok(!/계량고객|010/.test(JSON.stringify(pg)));
});

test('로스: 나중에 따로, 0이면 로스 없음, 무게보다 크면 거절, 장부 값과 다르면 물어봄', () => {
  const { e, a, L } = setup();
  const id = a.reservationId;
  q(e, { action: 'weighSave', id, bags: 3, weight: 40 });
  assert.strictEqual(q(e, { action: 'lossSave', id, loss: 50 }).error, 'loss_over');
  assert.strictEqual(q(e, { action: 'lossSave', id, loss: 3 }).ok, true);
  assert.strictEqual(rowOf(L, id)[6], 3);
  assert.strictEqual(q(e, { action: 'lossSave', id, loss: 1 }).error, 'mismatch');
  assert.strictEqual(q(e, { action: 'lossSave', id, loss: 0, force: true }).ok, true);
  assert.strictEqual(rowOf(L, id)[6], '');
  assert.strictEqual(q(e, { action: 'weighList' }).items.find(x => x.name === '계량고객').lossDone, true);
});

test('이체 파일: 계량 화면 계량 후 로스 미정이면 빠짐 → 로스 확인 뒤 들어가고 사진 버튼 입금 예정 알림톡(로스 차감 변수)', () => {
  const { e, a, L } = setup();
  const id = a.reservationId;
  q(e, { action: 'weighSave', id, bags: 3, weight: 40 });
  q(e, { action: 'weighPhoto', id, kind: '계량', data: IMG });
  let r = e.ctx.makeTransferFile({ dryRun: true });
  assert.strictEqual(r.count, 0); assert.ok(r.skipped.some(s => /로스 미정/.test(s.이유)));
  q(e, { action: 'lossSave', id, loss: 2 });
  rowOf(L, id)[8] = (40 - 2) * 250 - 2 * 200; // 장부 수식 결과 흉내
  r = e.ctx.makeTransferFile();
  assert.strictEqual(r.count, 1); assert.strictEqual(r.total, 9100);
  const m = e.fetches.map(f => f.body.messages[0]).find(x => x.kakaoOptions.templateId === 'KA01TPPAIDPHOTO');
  assert.ok(m, 'paidPhoto 발송');
  const v = m.kakaoOptions.variables;
  assert.strictEqual(v['#{로스}'], '2'); assert.strictEqual(v['#{로스단가}'], '200'); assert.strictEqual(v['#{무게}'], '38'); assert.strictEqual(v['#{금액}'], '9,100');
  assert.match(v['#{사진코드}'], /^[a-z0-9]{12}$/);
  assert.ok(!e.fetches.some(f => f.body.messages[0].kakaoOptions.templateId === 'KA01TPPAID'));
});

test('계량 화면을 안 쓴 날(직원이 장부에 직접 적은 기존 방식)은 그대로 이체·기존 입금 예정 알림톡', () => {
  const { e, a, L } = setup();
  const row = rowOf(L, a.reservationId);
  row[5] = 20; row[6] = 1; row[8] = 19 * 250 - 200;
  const r = e.ctx.makeTransferFile();
  assert.strictEqual(r.count, 1);
  assert.ok(e.fetches.some(f => f.body.messages[0].kakaoOptions.templateId === 'KA01TPPAID'));
});

test('정산 검토표: 사진 없음·로스 미정·장부와 계량 화면 다름 경고, 카톡 예약은 알림톡 안 감', () => {
  const { e, a, L } = setup();
  const id = a.reservationId;
  q(e, { action: 'weighSave', id, bags: 3, weight: 40 });
  const rows = e.ctx.settleReview_(['2026-11-16']);
  const me = rows.find(x => x['이름'] === '계량고객'), kt = rows.find(x => x['이름'] === '카톡손님');
  assert.match(me['경고'], /계량 사진 없음/); assert.match(me['경고'], /로스 미정/);
  assert.strictEqual(me['알림톡'], '보냄'); assert.match(String(me['번호']), /-3$/);
  assert.match(kt['알림톡'], /안 감/);
  rowOf(L, id)[5] = 41;   // 누가 장부를 고침
  assert.match(e.ctx.settleReview_(['2026-11-16']).find(x => x['이름'] === '계량고객')['경고'], /장부 무게가 계량 화면과 다름/);
});

test('2026-11-17 무상 희망 고객: 목록에 표시, 사진 업로드 거절, 로스 없이도 이체 파일에서 무상수거 알림톡만', () => {
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD] }, props: {} });
  const a = e0.post(sub({ date: '2026-11-16', name: '무상고객', noPay: true, bank: '', account: '', holder: '', amount: R.AMOUNTS[0] }));
  assert.strictEqual(a.ok, true, JSON.stringify(a));
  const e = createEnv({ now: NOW, ledger: { '11월 매입금액': [HEAD] }, props: READY });
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  const L = e.ledger['11월 매입금액'].rows; L.push(...e0.ledger['11월 매입금액'].rows.slice(1));
  const id = a.reservationId;
  const it = q(e, { action: 'weighList' }).items.find(x => x.name === '무상고객');
  assert.strictEqual(it.free, true);
  assert.strictEqual(q(e, { action: 'weighPhoto', id, kind: '계량', data: IMG }).error, 'free');
  assert.strictEqual(q(e, { action: 'weighSave', id, bags: 1, weight: 8 }).ok, true);
  const rv = e.ctx.settleReview_(['2026-11-16']).find(x => x['이름'] === '무상고객');
  assert.strictEqual(rv['경고'], ''); assert.strictEqual(rv['알림톡'], '무상수거 안내');
  const r = e.ctx.makeTransferFile();
  assert.strictEqual(r.count, 0); assert.strictEqual(r.free, 1);
  assert.ok(!r.skipped.some(s => /로스 미정/.test(s.이유)));
  assert.ok(e.fetches.some(f => f.body.messages[0].kakaoOptions.templateId === 'KA01TPFREE'));
});
