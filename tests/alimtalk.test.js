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
  assert.strictEqual(m.kakaoOptions.variables['#{예약번호}'], R.shortId(r.reservationId)); // 2026-11-17 고객에게는 짧은 번호
  assert.match(r.reservationId, /^ESD-261118-\d{4}$/); assert.match(m.kakaoOptions.variables['#{예약번호}'], /^1118-\d{4}$/);
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

test('입금 예정·무상수거 알림톡: 이체 파일 만들 때 보냄, 입금완료 처리 때는 다시 안 보냄 (계좌는 끝 4자리만)', () => {
  const e = env(READY);
  const a = e.post(sub({ date: '2026-11-16', name: '입금손님', account: '9998887776' }));
  const b = e.post(sub({ date: '2026-11-16', name: '무상손님' }));
  const L = e.ledger['11월 매입금액'].rows;
  L.find(x => x && x[2] === '입금손님')[5] = 40;
  L.find(x => x && x[2] === '무상손님')[5] = 10;
  // 실제 시트처럼 수거일 칸이 날짜 값인 경우 (글자로 바꾸면 'NaN/18(undefined)' 나던 문제)
  const BK = e.sheet('예약').rows, hd = BK[0]; BK.forEach((x, i) => { if (i) x[hd.indexOf('수거일')] = new Date('2026-11-16T00:00:00+09:00'); });
  const res = e.ctx.makeTransferFile();
  assert.strictEqual(res.count, 1); assert.strictEqual(res.free, 1);
  const free = e.fetches.find(f => f.body.messages[0].kakaoOptions.templateId === 'KA01TPFREE');
  assert.strictEqual(free.body.messages[0].kakaoOptions.variables['#{무게}'], '10');
  const file = e.sheet('예약').rows.find(x => x && x[0] === a.reservationId)[e.sheet('예약').rows[0].indexOf('이체파일')];
  const before = e.fetches.length;
  e.ctx.markTransferPaid(file);
  assert.strictEqual(e.fetches.length, before); // 송금 표시 때는 추가 발송 없음
  const paid = e.fetches.find(f => f.body.messages[0].kakaoOptions.templateId === 'KA01TPPAID');
  const v = paid.body.messages[0].kakaoOptions.variables;
  assert.strictEqual(v['#{수거일}'], '11/16(월)');
  assert.strictEqual(v['#{금액}'], '10,000'); assert.strictEqual(v['#{계좌끝4자리}'], '7776'); assert.strictEqual(v['#{이름}'], '입금손님');
  assert.ok(!JSON.stringify(paid.body).includes('9998887776'));
});

test('점검 메일에 알림톡 준비 상태(꺼짐·남은 것)', () => {
  const e = env({}, { notify: 'boss@example.com' });
  e.ctx.dailyReport();
  assert.match(e.mails[e.mails.length - 1].body, /알림톡: 꺼짐 \(준비 남음: API 키/);
});

test('2026-11-16 당일 안내: 오늘 수거할 확정 예약에만 보냄(취소·다른 날 제외), 버튼용 예약번호 변수 포함, 같은 날 두 번 안 보냄', () => {
  const e = createEnv({ now: '2026-11-17T08:30:00Z', ledger: { '11월 매입금액': [HEAD] }, props: Object.assign({}, READY, { TPL_SAMEDAY: 'KA01TPSAME' }) });
  // 11/17 17:30 기준. 예약은 그 전에 들어온 상황을 시트에 직접 만든다
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD] }, props: {} });
  const a = e0.post(sub({ date: '2026-11-17', name: '오늘고객', address: { sido: '서울', sigungu: '강남구', bname: '역삼동', roadAddress: '서울 강남구 가상로 1', zonecode: '00000' } }));
  const b = e0.post(sub({ date: '2026-11-18', name: '내일고객' }));
  assert.ok(a.ok && b.ok);
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  const r = e.ctx.sendSameDayNotices();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { sent: 1, skipped: 0, failed: 0 });
  const m = e.fetches[0].body.messages[0];
  assert.strictEqual(m.kakaoOptions.templateId, 'KA01TPSAME');
  assert.strictEqual(m.kakaoOptions.variables['#{예약번호}'], R.shortId(a.reservationId));
  assert.strictEqual(m.kakaoOptions.variables['#{주소}'], '서울 강남구 가상로 1 101호');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e.ctx.sendSameDayNotices())), { sent: 0, skipped: 1, failed: 0 }); // 이미 보냄
});

test('2026-11-16 준비 완료 버튼: 예약번호로 준비완료 시각 기록, 다시 눌러도 그대로, 이상한 번호·없는 번호는 거절, 개인정보 안 돌려줌', () => {
  const e = env({});
  const a = e.post(sub());
  const r1 = e.post({ action: 'ready', reservationId: a.reservationId.toLowerCase() });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r1)), { ok: true, date: '2026-11-18' });
  const h = e.sheet('예약').rows[0], row = e.sheet('예약').rows[1];
  assert.match(String(row[h.indexOf('준비완료')]), /^\d\d-\d\d \d\d:\d\d$/);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e.post({ action: 'ready', reservationId: a.reservationId }))), { ok: true, already: true, date: '2026-11-18' });
  assert.strictEqual(e.post({ action: 'ready', reservationId: 'x' }).error, 'bad_id');
  assert.strictEqual(e.post({ action: 'ready', reservationId: 'ESD-261118-ZZZZ' }).error, 'not_found');
});

test('2026-11-16 기사님 수거 사진: 올리면 저장·기록, 사진 있으면 [수거 사진 보기] 템플릿(사진코드), 고객 페이지는 사진만', () => {
  const e = env(Object.assign({}, READY, { TPL_PICKED_PHOTO: 'KA01TPPHOTO' }));
  const r = e.post(sub({ date: '2026-11-16' }));
  const img = Buffer.from('가짜사진').toString('base64');
  assert.strictEqual(e.post({ action: 'driverPhoto', key: 'BAD', date: '2026-11-16', id: r.reservationId, data: img }).error, 'forbidden');
  for (let i = 1; i <= 3; i++) assert.strictEqual(e.post({ action: 'driverPhoto', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, name: '신청고객', data: img }).count, i);
  assert.strictEqual(e.post({ action: 'driverPhoto', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, data: img }).error, 'too_many');
  const list = e.post({ action: 'driverList', key: 'GOODKEY123', date: '2026-11-16' });
  assert.strictEqual(list.items.find(x => x.rid === r.reservationId).photos, 3);
  const before = e.fetches.length;
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, state: '완료' });
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, state: '완료' });
  assert.strictEqual(e.fetches.length - before, 1);
  const m = e.fetches[e.fetches.length - 1].body.messages[0];
  assert.strictEqual(m.kakaoOptions.templateId, 'KA01TPPHOTO');
  const code = m.kakaoOptions.variables['#{사진코드}'];
  assert.match(code, /^[a-z0-9]{12}$/);
  const p = e.post({ action: 'pickupPhoto', code });
  assert.strictEqual(p.ok, true); assert.strictEqual(p.photos.length, 3); assert.strictEqual(p.photos[0], img);
  assert.strictEqual(p.date, '11/16(월)');
  assert.ok(!/신청고객|010|가상북로/.test(JSON.stringify(p)));
  assert.strictEqual(e.post({ action: 'pickupPhoto', code: 'zzzzzzzzzzzz' }).error, 'not_found');
  assert.strictEqual(e.post({ action: 'pickupPhoto', code: 'x' }).error, 'bad_code');
});

test('2026-11-16 사진 없이 완료하거나 사진 템플릿이 아직 없으면 기존 픽업 완료로', () => {
  const e = env(READY); // TPL_PICKED_PHOTO 없음
  const r = e.post(sub({ date: '2026-11-16' }));
  e.post({ action: 'driverPhoto', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, data: Buffer.from('x').toString('base64') });
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, state: '완료' });
  assert.strictEqual(e.fetches[e.fetches.length - 1].body.messages[0].kakaoOptions.templateId, 'KA01TPPICK');
  // 카톡 예약도 사진은 저장됨 (알림톡은 없음)
  e.ledger['11월 매입금액'].rows.push([null, D('2026-11-16'), '카톡손님', '은평구', '가상로']);
  assert.strictEqual(e.post({ action: 'driverPhoto', key: 'GOODKEY123', date: '2026-11-16', id: 'K:카톡손님|가상로', name: '카톡손님', data: Buffer.from('y').toString('base64') }).ok, true);
});

test('2026-11-17 짧은 예약번호: 준비 완료 버튼·취소·예약 찾기가 1118-4829 형태로 됨, 옛 번호(영문)도 그대로', () => {
  assert.strictEqual(R.shortId('ESD-261118-4829'), '1118-4829');
  assert.strictEqual(R.shortId('ESD-261116-AB12'), '1116-AB12');
  assert.strictEqual(R.shortId('이상한값'), '이상한값');
  const e = env({});
  const a = e.post(sub({ name: '짧은번호고객', phone: '010-5555-7788' }));
  const short = R.shortId(a.reservationId);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e.post({ action: 'ready', reservationId: short }))), { ok: true, date: '2026-11-18' });
  assert.strictEqual(e.post({ action: 'ready', reservationId: '1118-0000' }).error, a.reservationId.endsWith('0000') ? undefined : 'not_found');
  const f1 = e.ctx.findBookings_('7788'), f2 = e.ctx.findBookings_('짧은번호'), f3 = e.ctx.findBookings_(short);
  [f1, f2, f3].forEach(f => { assert.strictEqual(f.length, 1); assert.strictEqual(f[0].rid, a.reservationId); assert.strictEqual(f[0].short, short); });
  assert.strictEqual(e.ctx.findBookings_('0000').length, 0);
  const q = e.ctx.parseCancelInput_(short);
  assert.strictEqual(q.rid, a.reservationId); assert.strictEqual(q.date, '2026-11-18');
  const c = e.ctx.cancelReservation(short);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(e.ctx.findBookings_(short)[0].status, '취소');
});

test('2026-11-17 참관 번호(ALIM_CC): 고객에게 간 알림톡을 같은 템플릿·내용으로 대표 번호에도, 기록은 뒷4자리·중복 판단엔 안 섞임', () => {
  const e = env(Object.assign({}, READY, { ALIM_CC: '010-9999-8888' }));
  const r = e.post(sub());
  assert.strictEqual(e.fetches.length, 2);
  const [a, b] = e.fetches.map(f => f.body.messages[0]);
  assert.strictEqual(a.to, '01012345678'); assert.strictEqual(b.to, '01099998888');
  assert.strictEqual(b.kakaoOptions.templateId, a.kakaoOptions.templateId);
  assert.deepStrictEqual(b.kakaoOptions.variables, a.kakaoOptions.variables);
  const log = e.sheet('알림톡기록').rows.slice(1).map(x => [x[3], x[4]]);
  assert.deepStrictEqual(log, [['****5678', '성공'], ['****8888', '참관 성공']]);
  assert.ok(!JSON.stringify(e.sheet('알림톡기록').rows).includes('99998888'));
  const e2 = env(Object.assign({}, READY, { ALIM_CC: '' })); e2.post(sub()); assert.strictEqual(e2.fetches.length, 1);   // 없으면 안 보냄
});

test('2026-11-17 기사님: 사진 찍고 완료 → 완료 먼저(알림톡 보류), 사진 다 올린 뒤 driverPickedNotify 로 사진 버튼 알림톡 / 안 오면 5분 동기화가 3분 뒤 대신', () => {
  const P = Object.assign({}, READY, { TPL_PICKED_PHOTO: 'KA01TPPHOTO' });
  const e = env(P);
  const r = e.post(sub({ date: '2026-11-16' }));
  const before = e.fetches.length;
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, state: '완료', photoPending: true });
  assert.strictEqual(e.fetches.length, before);   // 아직 안 보냄
  e.post({ action: 'driverPhoto', key: 'GOODKEY123', date: '2026-11-16', id: r.reservationId, data: Buffer.from('p').toString('base64') });
  e.post({ action: 'driverPickedNotify', key: 'GOODKEY123', id: r.reservationId });
  assert.strictEqual(e.fetches.length, before + 1);
  assert.strictEqual(e.fetches[e.fetches.length - 1].body.messages[0].kakaoOptions.templateId, 'KA01TPPHOTO');
  // 다른 예약: 사진이 안 올라온 경우 → 5분 동기화가 3분 뒤 기본 픽업 완료로
  const r2 = e.post(sub({ date: '2026-11-16', name: '두번째', submissionId: 'sub-second-0002' }));
  const b2 = e.fetches.length;
  e.post({ action: 'driverMark', key: 'GOODKEY123', date: '2026-11-16', id: r2.reservationId, state: '완료', photoPending: true });
  assert.strictEqual(e.ctx.sendPendingPickups_(new Date(Date.parse('2026-11-16T03:01:00Z'))), 0);   // 1분 뒤엔 아직
  assert.strictEqual(e.ctx.sendPendingPickups_(new Date(Date.parse('2026-11-16T03:10:00Z'))), 1);  // 3분 넘으면 보냄
  assert.strictEqual(e.fetches.length, b2 + 1);
  assert.strictEqual(e.ctx.sendPendingPickups_(new Date(Date.parse('2026-11-16T03:20:00Z'))), 0);  // 두 번은 안 보냄
});

test('2026-11-23 당일 안내 중복은 그날만: 어제 보낸 기록이 있어도(날짜 바꾼 예약) 오늘 다시 보냄', () => {
  const e = createEnv({ now: '2026-11-17T08:30:00Z', ledger: { '11월 매입금액': [HEAD] }, props: Object.assign({}, READY, { TPL_SAMEDAY: 'KA01TPSAME' }) });
  const e0 = createEnv({ now: '2026-11-15T03:00:00Z', ledger: { '11월 매입금액': [HEAD] }, props: {} });
  const a = e0.post(sub({ date: '2026-11-17', name: '바뀐고객', address: { sido: '서울', sigungu: '강남구', bname: '역삼동', roadAddress: '서울 강남구 가상로 1', zonecode: '00000' } }));
  assert.ok(a.ok, JSON.stringify(a));
  e.ctx.bookData_(); e.sheet('예약').rows.splice(0, e.sheet('예약').rows.length, ...e0.sheet('예약').rows);
  e.ctx.alimLog_('sameday', a.reservationId, '01000000000', '성공');
  e.sheet('알림톡기록').rows[1][0] = '2026-11-16 17:30:01';
  assert.strictEqual(e.ctx.sendSameDayNotices().sent, 1);
  assert.strictEqual(e.ctx.sendSameDayNotices().sent, 0);
});
