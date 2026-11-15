// 사진 저장·알림 메일(Notify.gs) 테스트 — 가상 데이터만
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-harness.js');
const R = require('../assets/apply-rules.js');

const NOW = '2026-11-15T01:00:00Z';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString('base64');
const sub = (over = {}) => Object.assign({
  action: 'submit', submissionId: 'sub-' + Math.random().toString(36).slice(2, 12), name: '가상고객', phone: '010-0000-0000',
  address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상로 1', zonecode: '00000' },
  addressDetail: '101호', date: '2026-11-16', amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[0], entranceCode: '#1234#',
  bank: '신한은행', account: '0000000000', holder: '가상고객', agreeNotice: true, agreePrivacy: true, photoMode: R.PHOTO_MODES[0], memo: '박스 2개'
}, over);

test('사진: 예약 확정 후 최대 3장 저장, 예약 시트에 사진방식·링크, 같은 번호 재전송은 중복 안 됨', () => {
  const env = createEnv({ now: NOW });
  const p = sub(); const r = env.post(p);
  assert.strictEqual(r.ok, true);
  for (let i = 1; i <= 3; i++) assert.strictEqual(env.post({ action: 'photo', reservationId: r.reservationId, submissionId: p.submissionId, index: i, data: JPG }).ok, true);
  assert.strictEqual(env.post({ action: 'photo', reservationId: r.reservationId, submissionId: p.submissionId, index: 2, data: JPG }).duplicate, true);
  assert.strictEqual(env.post({ action: 'photo', reservationId: r.reservationId, submissionId: p.submissionId, index: 4, data: JPG }).error, 'too_many');
  assert.strictEqual(env.drive.files.length, 3);
  assert.strictEqual(env.drive.files[0].name, r.reservationId + '_1.jpg');
  const rows = env.sheet('예약').rows, h = rows[0];
  assert.strictEqual(rows[1][h.indexOf('사진방식')], '지금 올릴게요');
  assert.strictEqual(String(rows[1][h.indexOf('사진')]).split('\n').length, 3);
});

test('사진: 다른 제출ID(남의 예약)·없는 예약·너무 큰 사진은 거부', () => {
  const env = createEnv({ now: NOW });
  const p = sub(); const r = env.post(p);
  assert.strictEqual(env.post({ action: 'photo', reservationId: r.reservationId, submissionId: 'someone-else', index: 1, data: JPG }).error, 'forbidden');
  assert.strictEqual(env.post({ action: 'photo', reservationId: 'ESD-261116-ZZZZ', submissionId: p.submissionId, index: 1, data: JPG }).error, 'not_found');
  assert.strictEqual(env.post({ action: 'photo', reservationId: r.reservationId, submissionId: p.submissionId, index: 1, data: 'A'.repeat(2900000) }).error, 'too_large');
  assert.strictEqual(env.drive.files.length, 0);
});

test('사진 방식 미선택 → "사진 없이 신청할게요"로 저장', () => {
  const env = createEnv({ now: NOW });
  env.post(sub({ photoMode: undefined }));
  const rows = env.sheet('예약').rows, h = rows[0];
  assert.strictEqual(rows[1][h.indexOf('사진방식')], '사진 없이 신청할게요');
});

test('알림 메일: NOTIFY_EMAILS 설정 시 예약마다 요약 메일, 연락처·계좌·현관 비번은 안 넣음', () => {
  const env = createEnv({ now: NOW, notify: 'boss@example.com,staff@example.com' });
  env.post(sub()); env.post(sub({ name: '가상둘', holder: '가상둘' }));
  assert.strictEqual(env.mails.length, 2);
  const m = env.mails[1];
  assert.strictEqual(m.to, 'boss@example.com,staff@example.com');
  assert.match(m.subject, /^\[이수다 새 예약\] 11\/16\(월\) 마포구 · 가상둘 · 15kg 이상$/);
  assert.match(m.body, /이날 장부 포함 2건 \/ 한도 22건/);
  assert.ok(!/010-0000-0000|0000000000|#1234#/.test(m.subject + m.body));
});

test('알림 메일 주소가 없으면 보내지 않음(예약은 정상)', () => {
  const env = createEnv({ now: NOW });
  assert.strictEqual(env.post(sub()).ok, true);
  assert.strictEqual(env.mails.length, 0);
});

test('사진 미리 올리기: 고르는 즉시 저장 → 신청 때 같은 제출ID 사진만 예약에 연결, 하루 지난 미연결 사진은 정리', () => {
  const { createEnv } = require('./gas-harness.js');
  const R = require('../assets/apply-rules.js');
  const env = createEnv({ now: '2026-11-15T01:00:00Z', ledger: { '11월 매입금액': [[null, '날짜', '이름']] } });
  const sid = 'sub-preupload-1';
  const img = Buffer.from('fakejpeg').toString('base64');
  const a = env.post({ action: 'photoPre', submissionId: sid, data: img });
  const b = env.post({ action: 'photoPre', submissionId: sid, data: img });
  const other = env.post({ action: 'photoPre', submissionId: 'sub-someone-else', data: img });
  assert.strictEqual(a.ok, true); assert.ok(a.id);
  assert.strictEqual(env.post({ action: 'photoPre', submissionId: 'x', data: img }).error, 'bad_request');
  const r = env.post({ action: 'submit', submissionId: sid, name: '사진손님', phone: '010-0000-0000',
    address: { sido: '서울', sigungu: '마포구', bname: '성산동', roadAddress: '서울 마포구 가상로 1' }, addressDetail: '1호', date: '2026-11-16',
    amount: R.AMOUNTS[1], place: R.PLACES[0], entrance: R.ENTRANCE[1], photoMode: R.PHOTO_MODES[0], photoIds: [a.id, b.id, other.id],
    bank: '', account: '', holder: '', noPay: true, agreeNotice: true, agreePrivacy: true });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.photos, 2);                        // 다른 사람 사진은 안 붙음
  assert.ok(r.srv && r.srv.total >= 0 && r.srv.mail >= 0);
  const bk = env.sheet('예약').rows, h = bk[0], cell = bk[1][h.indexOf('사진')];
  assert.match(cell, new RegExp('^' + r.reservationId + '_1\.jpg .*\n' + r.reservationId + '_2\.jpg '));
  // 정리: 미연결(다른 사람) 사진은 하루 지나면 휴지통, 연결된 사진은 예약번호 이름으로
  const pre = env.sheet('사진대기').rows; pre.slice(1).forEach(row => { row[0] = '2026-11-13 10:00:00'; });
  env.ctx.tidyPrePhotos_();
  assert.strictEqual(env.drive.files.find(f => f.getId() === other.id).trashed, true);
  assert.strictEqual(env.drive.files.find(f => f.getId() === a.id).getName(), r.reservationId + '_1.jpg');
  assert.strictEqual(env.drive.files.find(f => f.getId() === a.id).trashed, false);
});
