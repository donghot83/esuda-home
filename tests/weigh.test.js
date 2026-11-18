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
  const code = e.ctx.pickPhotoCode_(id, true);   // 실제로는 입금 예정 알림톡 보낼 때 만들어짐
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

test('2026-11-18 계량·로스 한 번에: 로스 비우면 0, 로스 안 넣어도 이체에서 안 빠짐, 넣으면 사진 버튼 입금 예정 알림톡(로스 차감 변수)', () => {
  const { e, a, L } = setup();
  const id = a.reservationId;
  q(e, { action: 'weighSave', id, bags: 3, weight: 40 });
  q(e, { action: 'weighPhoto', id, kind: '계량', data: IMG });
  rowOf(L, id)[8] = 40 * 250;
  let r = e.ctx.makeTransferFile({ dryRun: true });
  assert.strictEqual(r.count, 1); assert.ok(!r.skipped.some(s => /로스 미정/.test(s.이유)));
  const z = q(e, { action: 'weighSave', id, bags: 3, weight: 40, withLoss: true, loss: '', excl: '' });
  assert.strictEqual(z.ok, true); assert.strictEqual(z.loss, 0); assert.strictEqual(z.lossDone, true);
  assert.strictEqual(q(e, { action: 'weighList' }).items.find(x => x.name === '계량고객').lossDone, true);
  assert.strictEqual(q(e, { action: 'weighSave', id, weight: 40, withLoss: true, loss: 50 }).error, 'loss_over');
  assert.ok(!rowOf(L, id)[6]);   // 거절되면 아무것도 안 씀
  const mm = q(e, { action: 'weighSave', id, weight: 41, withLoss: true, loss: 2 });
  assert.strictEqual(mm.error, 'mismatch'); assert.strictEqual(mm.what, '무게'); assert.ok(!rowOf(L, id)[6]);
  assert.strictEqual(q(e, { action: 'weighSave', id, bags: 3, weight: 40, withLoss: true, loss: 2 }).ok, true);
  assert.strictEqual(rowOf(L, id)[5], 40); assert.strictEqual(rowOf(L, id)[6], 2);
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

test('정산 검토표: 사진 없음·장부와 계량 화면 다름 경고, 카톡 예약은 알림톡 안 감', () => {
  const { e, a, L } = setup();
  const id = a.reservationId;
  q(e, { action: 'weighSave', id, bags: 3, weight: 40 });
  const rows = e.ctx.settleReview_(['2026-11-16']);
  const me = rows.find(x => x['이름'] === '계량고객'), kt = rows.find(x => x['이름'] === '카톡손님');
  assert.match(me['경고'], /계량 사진 없음/); assert.doesNotMatch(me['경고'], /로스 미정/);
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

test('2026-11-17 세 경우: 15kg 미만은 로스 없이 이체(무상 계근 사진 알림톡), 무상 희망은 사진 없는 완료 알림톡, 유상은 매입 정산 알림톡', () => {
  const P = Object.assign({}, READY, { TPL_SETTLE: 'KA01TPSETTLE', TPL_FREE_UNDER: 'KA01TPUNDER', TPL_FREE_WISH: 'KA01TPWISH' });
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD] }, props: {} });
  const under = e0.post(sub({ date: '2026-11-16', name: '적은고객', phone: '010-1111-0001' }));
  const paid = e0.post(sub({ date: '2026-11-16', name: '매입고객', phone: '010-1111-0002' }));
  const wish = e0.post(sub({ date: '2026-11-16', name: '희망고객', phone: '010-1111-0003', noPay: true, bank: '', account: '', holder: '', amount: R.AMOUNTS[0] }));
  const e = createEnv({ now: NOW, ledger: { '11월 매입금액': [HEAD] }, props: P });
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  const L = e.ledger['11월 매입금액'].rows; L.push(...e0.ledger['11월 매입금액'].rows.slice(1));
  q(e, { action: 'weighSave', id: under.reservationId, bags: 1, weight: 9 });
  q(e, { action: 'weighPhoto', id: under.reservationId, kind: '계량', data: IMG });
  q(e, { action: 'weighSave', id: paid.reservationId, bags: 3, weight: 40 });
  q(e, { action: 'weighPhoto', id: paid.reservationId, kind: '계량', data: IMG });
  q(e, { action: 'lossSave', id: paid.reservationId, loss: 2 });
  q(e, { action: 'weighSave', id: wish.reservationId, bags: 1, weight: 20 });
  rowOf(L, paid.reservationId)[8] = 38 * 250 - 2 * 200;
  rowOf(L, under.reservationId)[8] = '무상수거';
  assert.ok(!e.ctx.settleReview_(['2026-11-16']).find(x => x['이름'] === '적은고객')['경고'].includes('로스 미정'));
  const r = e.ctx.makeTransferFile();
  assert.strictEqual(r.count, 1); assert.strictEqual(r.free, 2);
  assert.ok(!r.skipped.some(s => /로스 미정/.test(s.이유)), JSON.stringify(r.skipped));
  const by = id => e.fetches.map(f => f.body.messages[0]).filter(m => m.kakaoOptions.templateId === id);
  const s = by('KA01TPSETTLE'); assert.strictEqual(s.length, 1);
  assert.deepStrictEqual([s[0].kakaoOptions.variables['#{정산중량}'], s[0].kakaoOptions.variables['#{매입단가}'], s[0].kakaoOptions.variables['#{로스}'], s[0].kakaoOptions.variables['#{로스금액}'], s[0].kakaoOptions.variables['#{매입금액}']], ['38', '250', '2', '400', '9,100']);
  const u = by('KA01TPUNDER'); assert.strictEqual(u.length, 1); assert.strictEqual(u[0].kakaoOptions.variables['#{수거중량}'], '9');
  assert.match(u[0].kakaoOptions.variables['#{사진코드}'], /^[a-z0-9]{12}$/);
  assert.strictEqual(by('KA01TPWISH').length, 1);
  assert.strictEqual(by('KA01TPFREE').length, 0);
  const pg = e.post({ action: 'pickupPhoto', code: u[0].kakaoOptions.variables['#{사진코드}'] });
  assert.strictEqual(pg.free, true); assert.strictEqual(pg.weigh.length, 1); assert.strictEqual(pg.loss.length, 0);
});

test('2026-11-18 정산 미리보기: 보내지 않고 고객별 알림톡 문구·버튼 링크·금액, 빠진 고객까지 보여 줌', () => {
  const TPL = { KA01TPPAIDPHOTO: { content: '#{이름}님 #{무게}kg 총 #{금액}원 (로스 #{로스}kg)', status: 'APPROVED', buttons: [{ buttonName: '계량 사진 보기', linkMo: 'https://esuda.kr/photo/?c=#{사진코드}' }] } };
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD] }, props: {} });
  const a = e0.post(sub({ date: '2026-11-16', name: '미리고객' }));
  const b = e0.post(sub({ date: '2026-11-16', name: '무게없음' }));
  const e = createEnv({ now: NOW, ledger: { '11월 매입금액': [HEAD] }, props: READY, templates: TPL });
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  const L = e.ledger['11월 매입금액'].rows; L.push(...e0.ledger['11월 매입금액'].rows.slice(1));
  q(e, { action: 'weighSave', id: a.reservationId, bags: 3, weight: 40, withLoss: true, loss: 2 });
  q(e, { action: 'weighPhoto', id: a.reservationId, kind: '계량', data: IMG });
  rowOf(L, a.reservationId)[8] = 38 * 250 - 2 * 200;
  const sent0 = e.fetches.length;
  const r = e.ctx.settlePreview_();
  assert.strictEqual(e.fetches.length, sent0);                       // 아무것도 안 보냄
  assert.strictEqual(r.count, 1); assert.strictEqual(r.total, 9100);
  const me = r.rows.find(x => x['이름'] === '미리고객');
  assert.strictEqual(me['처리'], '이체'); assert.strictEqual(me['알림톡'], '입금 예정(사진)');
  assert.strictEqual(me['문구'], '미리고객님 38kg 총 9,100원 (로스 2kg)');
  assert.match(me['버튼'], /^\[계량 사진 보기\] https:\/\/esuda\.kr\/photo\/\?c=[a-z0-9]{12}$/);
  assert.strictEqual(me['받는번호'], '****3333');
  assert.match(r.rows.find(x => x['이름'] === '무게없음')['처리'], /^빠짐/);
  assert.strictEqual(e.sheet('예약').rows.slice(1).filter(x => String(x[e.sheet('예약').rows[0].indexOf('지급상태')] || '')).length, 0);   // 표시도 안 함
  e.ctx.makeTransferFile();                                          // 실제로 만들면 같은 사진코드로 발송
  const m = e.fetches.map(f => f.body && f.body.messages && f.body.messages[0]).filter(Boolean).find(x => x.kakaoOptions.templateId === 'KA01TPPAIDPHOTO');
  assert.ok(m); assert.ok(me['버튼'].endsWith(m.kakaoOptions.variables['#{사진코드}']));
});

test('2026-11-18 무상 희망(15kg 이상) 고객: 무상 희망 템플릿 승인 전엔 "15kg 미만" 무상수거 문구를 보내지 않음', () => {
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD] }, props: {} });
  const a = e0.post(sub({ date: '2026-11-16', name: '희망큰손님', noPay: true, bank: '', account: '', holder: '', amount: R.AMOUNTS[0] }));
  const e = createEnv({ now: NOW, ledger: { '11월 매입금액': [HEAD] }, props: READY });
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  const L = e.ledger['11월 매입금액'].rows; L.push(...e0.ledger['11월 매입금액'].rows.slice(1));
  q(e, { action: 'weighSave', id: a.reservationId, bags: 2, weight: 27 });
  rowOf(L, a.reservationId)[8] = 27 * 250;
  const pv = e.ctx.settlePreview_().rows.find(x => x['이름'] === '희망큰손님');
  assert.match(pv['알림톡'], /승인 전/);
  const r = e.ctx.makeTransferFile();
  assert.strictEqual(r.free, 1);
  assert.ok(!e.fetches.some(f => f.body && f.body.messages && f.body.messages[0].kakaoOptions.templateId === 'KA01TPFREE'));
});

test('2026-11-18 정산 알림톡: 무상제외·로스가 있을 때만 그 줄이 있는 템플릿으로 (없는 템플릿은 TPL_SETTLE로)', () => {
  const P = Object.assign({}, READY, { TPL_SETTLE: 'T_LOSS', TPL_SETTLE_BASE: 'T_BASE', TPL_SETTLE_EXCL: 'T_EXCL', TPL_SETTLE_BOTH: 'T_BOTH', TPL_FREE_UNDER: 'T_UNDER', TPL_FREE_UNDER_EXCL: 'T_UNDEREX' });
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD.slice(0, 6).concat(['무상제외'], HEAD.slice(6))] }, props: {} });
  const cs = [['기본', 30, '', ''], ['로스만', 30, '', 2], ['제외만', 30, 3, ''], ['둘다', 30, 3, 2], ['적은제외', 16, 3, '']].map(([n, w, x, l], i) =>
    ({ n, w, x, l, a: e0.post(sub({ date: '2026-11-16', name: n, phone: '010-1111-000' + i })) }));
  const e = createEnv({ now: NOW, ledger: { '11월 매입금액': [HEAD.slice(0, 6).concat(['무상제외'], HEAD.slice(6))] }, props: P });
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  const L = e.ledger['11월 매입금액'].rows; L.push(...e0.ledger['11월 매입금액'].rows.slice(1));
  cs.forEach(c => {
    assert.strictEqual(q(e, { action: 'weighSave', id: c.a.reservationId, bags: 1, weight: c.w, withLoss: true, loss: c.l, excl: c.x }).ok, true, c.n);
    q(e, { action: 'weighPhoto', id: c.a.reservationId, kind: '계량', data: IMG });
    const row = L.find(x => x && String(x[11] || '').includes(c.a.reservationId));
    const fin = c.w - (+c.x || 0) - (+c.l || 0); row[9] = fin >= 15 ? fin * 250 - (+c.l || 0) * 200 : '무상수거';
  });
  e.ctx.makeTransferFile();
  const by = n => e.fetches.map(f => f.body && f.body.messages && f.body.messages[0]).filter(Boolean).find(m => m.to === '0101111000' + cs.findIndex(c => c.n === n));
  assert.strictEqual(by('기본').kakaoOptions.templateId, 'T_BASE');
  assert.strictEqual(by('로스만').kakaoOptions.templateId, 'T_LOSS');
  assert.strictEqual(by('제외만').kakaoOptions.templateId, 'T_EXCL');
  const both = by('둘다').kakaoOptions;
  assert.strictEqual(both.templateId, 'T_BOTH');
  assert.deepStrictEqual([both.variables['#{수거중량}'], both.variables['#{무상제외}'], both.variables['#{로스}'], both.variables['#{정산중량}'], both.variables['#{매입금액}']], ['30', '3', '2', '25', '5,850']);
  const u = by('적은제외').kakaoOptions;
  assert.strictEqual(u.templateId, 'T_UNDEREX'); assert.strictEqual(u.variables['#{정산중량}'], '13');
});

test('2026-11-18 카톡·직원 줄도 계량 화면으로 무게 넣으면 최종·금액·로스금액 수식이 생김 (직원이 적은 칸은 그대로)', () => {
  const { e, L } = setup();
  const k = q(e, { action: 'weighList' }).items.find(x => x.name === '카톡손님');
  const row = L.find(x => x && x[2] === '카톡손님'), idx = L.indexOf(row) + 1;
  assert.strictEqual(q(e, { action: 'weighSave', id: k.id, bags: 2, weight: 30, withLoss: true, loss: '' }).ok, true);
  const f = row.f || {};
  assert.ok(String(f[8]).startsWith('=IF(F' + idx + '=""'), String(f[8]));   // 최종 (8번째 칸)
  assert.match(String(f[9]), /\*250-N\(G\d+\)\*200,"무상수거"/);       // 금액
  row.f = {}; row[8] = 7000;                                            // 직원이 금액을 직접 적어 둔 줄
  q(e, { action: 'weighSave', id: k.id, bags: 2, weight: 30, withLoss: true, loss: 1, force: true });
  assert.ok(!(row.f || {})[8]); assert.strictEqual(row[8], 7000);
});
