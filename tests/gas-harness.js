// Google Apps Script 가짜 환경: 메모리 시트로 Code.gs + 규칙 파일을 그대로 실행한다.
// 테스트와 로컬 미리보기(tools/mock_server.js)에서 같이 쓴다. 실제 구글 계정·데이터 없음.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 서식 메서드(setFontWeight 등)는 아무 일 없이 자기 자신을 돌려주는 range
function anyRange(base) {
  const p = new Proxy(base, { get(t, k) { if (k in t) return (...a) => { const r = t[k](...a); return r === undefined ? p : r; }; return () => p; } });
  return p;
}

function makeSheet(name) {
  const rows = [];
  const sh = {
    name, rows,
    appendRow(r) { rows.push(r.map(x => (typeof x === 'string' && x.startsWith("'")) ? x.slice(1) : x)); },
    getDataRange() { return { getValues: () => rows.map(r => r.slice()) }; },
    getRange(r, c, nr, nc) { return anyRange({
      setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; },
      setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { while (rows.length < r + i) rows.push([]); rows[r - 1 + i][c - 1 + j] = v; })); },
      getValue() { return (rows[r - 1] || [])[c - 1]; }
    }); },
    clear() { rows.length = 0; }, setFrozenRows() {}, setColumnWidth() {}, setColumnWidths() {}, getName() { return name; },
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
    getRange(r, c, nr, nc) {
      const rng = {
        setValue(v) { fit(r); rows[r - 1][c - 1] = v; return rng; },
        setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { fit(r + i); rows[r - 1 + i][c - 1 + j] = v; })); return rng; },
        setNumberFormat(f) { fit(r); (rows[r - 1].fmt = rows[r - 1].fmt || {})[c] = f; return rng; },
        getNumberFormats() { return Array.from({ length: nr || 1 }, (_, i) => [((rows[r - 1 + i] || {}).fmt || {})[c] || '']); },
        getValue() { return (rows[r - 1] || [])[c - 1]; },
        copyTo() {}
      };
      return rng;
    },
    deleteRow(r) { rows.splice(r - 1, 1); },
    getName() { return name; },
    setName(n) { this.name = n; }
  };
}

function makeSpreadsheet(name) {
  const sheets = [makeGrid('Sheet1')];
  return {
    name, sheets,
    getSheets: () => sheets,
    insertSheet: n => { const g = makeGrid(n); sheets.push(g); return g; },
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    getUrl: () => 'https://docs.google.com/fake/' + encodeURIComponent(name)
  };
}

function createEnv(opts = {}) {
  const sheets = {};
  const props = { STAFF_TOKEN: opts.staffToken || 'test-token' };
  if (opts.ledger) props.LEDGER_ID = 'LEDGER';
  Object.assign(props, opts.props || {});
  if (opts.notify) props.NOTIFY_EMAILS = opts.notify;
  const ledgerSheets = {};
  const otherLedgers = {};
  const created = [];
  const drive = { folders: {}, files: [] };
  const mails = [];
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
      newDataValidation: () => anyRange({}),
      openById: id => {
        if (opts.ledgerFail) throw new Error('ledger unavailable');
        const sheetsOf = id === 'LEDGER' ? ledgerSheets : (otherLedgers[id] = otherLedgers[id] || {});
        return { getSheetByName: n => sheetsOf[n] || null, getSpreadsheetTimeZone: () => opts.ledgerTz || 'Asia/Seoul' };
      },
      CopyPasteType: { PASTE_FORMAT: 'format' },
      create: n => { const s = makeSpreadsheet(n); created.push(s); return s; },
      flush() {}
    },
    LockService: { getScriptLock: () => ({ tryLock: () => (locked ? false : (locked = true)), releaseLock: () => { locked = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    DriveApp: {
      getFolderById: id => { const f = drive.folders[id]; if (!f) throw new Error('no folder'); return f; },
      getFoldersByName: n => { const l = Object.values(drive.folders).filter(f => f.name === n); return { hasNext: () => l.length > 0, next: () => l.shift() }; },
      createFolder: n => { const id = 'F' + Object.keys(drive.folders).length; const f = { name: n, getId: () => id,
        createFile: b => { const file = { name: b.name, bytes: b.bytes, getUrl: () => 'https://drive.google.com/fake/' + b.name, getName: () => b.name }; drive.files.push(file); return file; } };
        drive.folders[id] = f; return f; }
    },
    MailApp: { sendEmail: m => { mails.push(m); } },
    ScriptApp: { getProjectTriggers: () => (opts.noTrigger ? [] : [{ getHandlerFunction: () => 'syncLedgerPending' }]) },
    Logger: { log() {} },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ text: s, setMimeType() { return this; } })
    },
    Utilities: {
      base64Decode: d => Array.from(Buffer.from(d, 'base64')),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      // 시간대: 'Asia/Seoul'=+9, 'GMT'=0 만 흉내 (테스트용)
      parseDate(s, tz, f) {
        const off = tz === 'GMT' ? 0 : 9;
        const [y, m, d] = s.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d) - off * 3600e3);
      },
      formatDate(d, tz, f) {
        const k = new Date(d.getTime() + (tz === 'GMT' ? 0 : 9) * 3600e3);
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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/apps-script/Transfer.gs'), 'utf8'), ctx, { filename: 'Transfer.gs' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/apps-script/Notify.gs'), 'utf8'), ctx, { filename: 'Notify.gs' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/apps-script/Report.gs'), 'utf8'), ctx, { filename: 'Report.gs' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/apps-script/Driver.gs'), 'utf8'), ctx, { filename: 'Driver.gs' });
  const call = (fn, arg) => JSON.parse(ctx[fn](arg).text);
  return {
    ctx, sheets, ledger: ledgerSheets, otherLedgers, props, created, drive, mails,
    get: params => call('doGet', { parameter: params }),
    post: body => call('doPost', { postData: { contents: JSON.stringify(body) } }),
    sheet: n => sheets[n],
    setLocked: v => { locked = v; }
  };
}

module.exports = { createEnv };
