const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { recipientKey } = require('../lib/config');
const { Journal } = require('../lib/state');
const { automaticWindow, windowStillOpen, checkSchedule } = require('../lib/schedule');

const timeZone = 'Asia/Ho_Chi_Minh';

test('lịch tự động chặn lượt trễ lúc 01:03 và chỉ mở đúng ba khoảng giờ Việt Nam', () => {
  const cases = [
    ['2026-10-15T01:03:20+07:00', null],
    ['2026-10-15T08:16:59+07:00', null],
    ['2026-10-15T08:17:00+07:00', 'morning'],
    ['2026-10-15T11:59:59+07:00', 'morning'],
    ['2026-10-15T12:00:00+07:00', null],
    ['2026-10-15T12:16:59+07:00', null],
    ['2026-10-15T12:17:00+07:00', 'noon'],
    ['2026-10-15T17:59:59+07:00', 'noon'],
    ['2026-10-15T18:00:00+07:00', null],
    ['2026-10-15T20:16:59+07:00', null],
    ['2026-10-15T20:17:00+07:00', 'evening'],
    ['2026-10-15T22:59:59+07:00', 'evening'],
    ['2026-10-15T23:00:00+07:00', null],
    ['2026-10-16T00:00:00+07:00', null],
  ];
  for (const [instant, slot] of cases) {
    const actual = automaticWindow(timeZone, new Date(instant));
    assert.equal(actual?.slot ?? null, slot, instant);
    if (actual) assert.equal(actual.day, '2026-10-15');
  }
  const morning = automaticWindow(timeZone, new Date('2026-10-15T08:17:00+07:00'));
  assert.equal(windowStillOpen(timeZone, morning, new Date('2026-10-15T12:17:00+07:00')), false);
  assert.equal(windowStillOpen(timeZone, morning, new Date('2026-10-16T08:17:00+07:00')), false);
});

test('lượt dự phòng chỉ xử lý người chưa có lượt và không đặt lại sent, uncertain, reserved', async () => {
  const recipients = ['alice', 'bob', 'carol', 'dave'].map(username => ({ username }));
  const config = { enabled: true, timeZone, accountUsername: 'owner', recipients };
  let state = {
    version: 2,
    entries: Object.fromEntries(recipients.map((recipient, i) => [
      recipientKey('owner', recipient.username),
      { day: '2026-10-15', slots: { noon: ['sent', 'uncertain', 'reserved', 'failed'][i] } },
    ])),
  };
  const original = structuredClone(state);
  const journal = new Journal({ load: async () => state, save: async () => { throw new Error('Không được ghi khi chỉ kiểm tra.'); } });
  const date = new Date('2026-10-15T12:56:43+07:00');
  assert.equal((await checkSchedule(config, journal, date)).proceed, true);
  assert.deepEqual(state, original);
  config.recipients = recipients.slice(0, 3);
  assert.equal((await checkSchedule(config, journal, date)).proceed, false);
  assert.equal((await checkSchedule(config, journal, new Date('2026-10-15T20:17:00+07:00'))).proceed, true);
  assert.equal((await checkSchedule(config, journal, new Date('2026-10-16T12:17:00+07:00'))).proceed, true);
  const mustNotReadState = { blocked: async () => { throw new Error('Không cần đọc trạng thái.'); } };
  assert.equal((await checkSchedule(config, mustNotReadState, new Date('2026-10-15T01:03:20+07:00'))).proceed, false);
  assert.equal((await checkSchedule({ ...config, enabled: false }, mustNotReadState, date)).proceed, false);
});

function runScheduledFixture(scenario) {
  const code = `
    const NativeDate = Date;
    const scenario = ${JSON.stringify(scenario)};
    let now = NativeDate.parse(scenario.start);
    global.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
    const { recipientKey } = require('./lib/config');
    let state = { version: 2, entries: {} };
    const calls = { launch: 0, send: 0, write: 0, close: 0 };
    if (scenario.alreadyDone) state.entries[recipientKey('fixture_owner', 'fixture_recipient')] = { day: '2026-10-15', slots: { noon: 'uncertain' } };
    require('./lib/state').LocalState = class {
      async load() { return structuredClone(state); }
      async save(next) { calls.write++; state = structuredClone(next); }
    };
    require('playwright').chromium.launch = async () => {
      calls.launch++;
      return {
        async newContext() { return { async addCookies() {}, async newPage() { return {}; } }; },
        async close() { calls.close++; },
      };
    };
    require('./lib/tiktok').TikTok = class {
      async open() {}
      async verifyAccount() { if (scenario.afterReady) now = NativeDate.parse(scenario.afterReady); }
      async selectRecipient() {}
      async prepare() {}
      async send(expected, message, markAttempt) {
        if (scenario.beforeEnter) now = NativeDate.parse(scenario.beforeEnter);
        markAttempt();
        calls.send++;
        return true;
      }
    };
    require('./index').main().then(() => console.log(JSON.stringify({ calls, state }))).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: {
      ...process.env, GITHUB_ACTIONS: 'false', GITHUB_EVENT_NAME: 'schedule', GITHUB_STEP_SUMMARY: '',
      BOT_ENABLED: 'true', ACCOUNT_USERNAME: 'fixture_owner', RECIPIENTS_JSON: '["fixture_recipient"]',
      COOKIES_JSON: JSON.stringify([{ name: 'sessionid', value: 'fixture_session', domain: '.tiktok.com' }]),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

test('bot không mở trình duyệt lúc 01:03 hoặc khi lượt dự phòng đã bị chống trùng', () => {
  for (const scenario of [
    { start: '2026-10-15T01:03:20+07:00' },
    { start: '2026-10-15T12:56:43+07:00', alreadyDone: true },
  ]) {
    const { calls } = runScheduledFixture(scenario);
    assert.equal(calls.launch, 0);
    assert.equal(calls.send, 0);
    assert.equal(calls.write, 0);
  }
});

test('trình duyệt mở chậm qua giờ đóng khung không được gửi bù', () => {
  const { calls } = runScheduledFixture({ start: '2026-10-15T22:59:59+07:00', afterReady: '2026-10-15T23:00:01+07:00' });
  assert.equal(calls.launch, 1);
  assert.equal(calls.send, 0);
  assert.equal(calls.write, 0);
  assert.equal(calls.close, 1);
});

test('khung đóng ngay trước Enter thì chưa gửi và không để lượt ở trạng thái reserved', () => {
  const { calls, state } = runScheduledFixture({ start: '2026-10-15T22:59:59+07:00', beforeEnter: '2026-10-15T23:00:01+07:00' });
  assert.equal(calls.send, 0);
  assert.equal(calls.close, 1);
  assert.equal(state.entries[recipientKey('fixture_owner', 'fixture_recipient')].slots.evening, 'failed');
});
