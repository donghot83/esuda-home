// Google Apps Script 가짜 환경: 메모리 시트로 Code.gs + 규칙 파일을 그대로 실행한다.
// 테스트와 로컬 미리보기(tools/mock_server.js)에서 같이 쓴다. 실제 구글 계정·데이터 없음.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function makeSheet(name) {
  const rows = [];
  const sh = {
    name, rows,
    appendRow(r) { rows.push(r.map(x => (typeof x === 'string' && x.startsWith("'")) ? x.slice(1) : x)); },
    getDataRange() { return { getValues: () => rows.map(r => r.slice()) }; },
    getRange(r, c) { return { setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; } }; },
    failNextAppend: false
  };
  const orig = sh.appendRow;
  sh.appendRow = function (r) { if (sh.failNextAppend) { sh.failNextAppend = false; throw new Error('append failed'); } return orig(r); };
  return sh;
}

// 장부(다른 스프레드시트)용 가짜 시트: 행 끼워 넣기·칸 쓰기 지원
function makeGrid(name, rows) {
  rows = rows || [];
  const fit = r => { while (rows.length < r) rows.push([]); };
  return {
    name, rows,
    getDataRange() { return { getValues: () => rows.map(r => r.slice()) }; },
    insertRowsAfter(r, n) { fit(r); rows.splice(r, 0, ...Array.from({ length: n }, () => [])); },
    insertRowsBefore(r, n) { fit(r - 1); rows.splice(r - 1, 0, ...Array.from({ length: n }, () => [])); },
    getRange(r, c) { return { setValue(v) { fit(r); rows[r - 1][c - 1] = v; }, copyTo() {} }; }
  };
}

function createEnv(opts = {}) {
  const sheets = {};
  const props = { STAFF_TOKEN: opts.staffToken || 'test-token' };
  if (opts.ledger) props.LEDGER_ID = 'LEDGER';
  const ledgerSheets = {};
  Object.entries(opts.ledger || {}).forEach(([n, rows]) => { ledgerSheets[n] = makeGrid(n, rows); });
  if (opts.ledgerFail) props.LEDGER_ID = 'LEDGER';
  let locked = false;
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: n => sheets[n] || null,
        insertSheet: n => (sheets[n] = makeSheet(n))
      }),
      openById: id => {
        if (opts.ledgerFail) throw new Error('ledger unavailable');
        return { getSheetByName: n => ledgerSheets[n] || null };
      },
      CopyPasteType: { PASTE_FORMAT: 'format' },
      flush() {}
    },
    LockService: { getScriptLock: () => ({ tryLock: () => (locked ? false : (locked = true)), releaseLock: () => { locked = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ text: s, setMimeType() { return this; } })
    },
    Utilities: {
      formatDate(d, tz, f) {
        const k = new Date(d.getTime() + 9 * 3600e3);
        const p = n => String(n).padStart(2, '0');
        const ymd = `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
        return f === 'yyyy-MM-dd' ? ymd : `${ymd} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
      }
    },
    Date: opts.now ? class extends Date { constructor(...a) { if (a.length) super(...a); else super(opts.now); } static now() { return new Date(opts.now).getTime(); } } : Date
  };
  ctx.self = undefined;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/apps-script/Rules.gs'), 'utf8'), ctx, { filename: 'Rules.gs' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/apps-script/Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/apps-script/Ledger.gs'), 'utf8'), ctx, { filename: 'Ledger.gs' });
  const call = (fn, arg) => JSON.parse(ctx[fn](arg).text);
  return {
    ctx, sheets, ledger: ledgerSheets,
    get: params => call('doGet', { parameter: params }),
    post: body => call('doPost', { postData: { contents: JSON.stringify(body) } }),
    sheet: n => sheets[n],
    setLocked: v => { locked = v; }
  };
}

module.exports = { createEnv };
