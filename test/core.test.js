const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { username, loadConfig, normalizeCookies, requireSessionForUrl, localDay, sendWindow, chooseMessage, recipientKey } = require('../lib/config');
const { Journal, LocalState, GitHubState, validateState } = require('../lib/state');

test('chọn nhiều người bằng username, loại trùng và giữ tin riêng', () => {
  const config = loadConfig({ ACCOUNT_USERNAME: 'owner', RECIPIENTS_JSON: '["@Alice", "alice", {"username":"https://www.tiktok.com/@bob", "message":"giữ chuỗi nhé 🔥"}]' });
  assert.deepEqual(config.recipients.map(item => item.username), ['alice', 'bob']);
  assert.equal(config.recipients[1].message, 'giữ chuỗi nhé 🔥');
  assert.equal(config.enabled, false);
  assert.throws(() => username('https://evil.example/@alice'));
  assert.throws(() => loadConfig({ BOT_ENABLED: 'yes' }));
  assert.throws(() => loadConfig({ ACCOUNT_USERNAME: 'alice', RECIPIENTS_JSON: '["alice"]' }));
  assert.throws(() => loadConfig({ RECIPIENTS_JSON: '{"all":true}' }));
});

test('cookie phiên còn sống được giữ, cookie hết hạn và domain ngoài bị loại', () => {
  const cookies = normalizeCookies([
    { name: 'sessionid', value: 'fixture', domain: '.tiktok.com', session: true },
    { name: 'old', value: 'fixture', domain: '.tiktok.com', expirationDate: 10 },
    { name: 'other', value: 'fixture', domain: '.example.com', expirationDate: 2000 },
    { name: 'sid', value: 'fixture', domain: '.tiktok.com', expirationDate: 2000, sameSite: 'lax' },
  ], 1000);
  assert.deepEqual(cookies.map(cookie => cookie.name), ['sessionid', 'sid']);
  assert.equal(cookies[1].sameSite, 'Lax');
  assert.throws(() => normalizeCookies([{ name: 'sessionid', value: 'fixture', domain: '.tiktok.com', expires: 10 }], 1000));
});

test('cookie đăng nhập phải có phạm vi bao gồm trang hộp thư thực tế', () => {
  const inbox = 'https://www.tiktok.com/messages?lang=en';
  const session = { name: 'sessionid', value: 'fixture', domain: '.tiktok.com', path: '/' };
  assert.doesNotThrow(() => requireSessionForUrl(normalizeCookies([session]), inbox));
  assert.doesNotThrow(() => requireSessionForUrl(normalizeCookies([{ ...session, domain: 'www.tiktok.com', hostOnly: true, path: '/messages' }]), inbox));
  assert.doesNotThrow(() => requireSessionForUrl(normalizeCookies([{ ...session, domain: 'tiktok.com', hostOnly: false }]), inbox));
  for (const invalid of [
    { ...session, domain: 'tiktok.com', hostOnly: true },
    { ...session, domain: '.ads.tiktok.com' },
    { ...session, path: '/api' },
    { ...session, path: '/message' },
    { ...session, value: ' ' },
  ]) assert.throws(() => requireSessionForUrl(normalizeCookies([invalid]), inbox), /không áp dụng/);
});

test('check-config không cần trình duyệt và không in giá trị Secrets', () => {
  const result = spawnSync(process.execPath, ['index.js', '--check-config'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      BOT_ENABLED: 'false',
      ACCOUNT_USERNAME: 'fixture_owner',
      RECIPIENTS_JSON: '["fixture_recipient"]',
      COOKIES_JSON: JSON.stringify([{ name: 'sessionid', value: 'fixture_private_session', domain: '.tiktok.com' }]),
      PLAYWRIGHT_BROWSERS_PATH: '/missing-browser-for-config-check',
      GITHUB_STEP_SUMMARY: '',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 người nhận/);
  assert.match(result.stdout, /Chưa kiểm tra TikTok/);
  for (const privateValue of ['fixture_owner', 'fixture_recipient', 'fixture_private_session']) assert.equal(result.stdout.includes(privateValue), false);
});

test('ngày chống trùng đổi lúc nửa đêm Việt Nam thay vì UTC', () => {
  assert.equal(localDay('Asia/Ho_Chi_Minh', new Date('2026-10-13T16:59:59Z')), '2026-10-13');
  assert.equal(localDay('Asia/Ho_Chi_Minh', new Date('2026-10-13T17:00:00Z')), '2026-10-14');
});

test('gửi xong hoặc runner chết sau khi đặt chỗ vẫn không gửi lại trong khung sáng', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streak-test-'));
  const file = path.join(dir, 'state.json');
  const key = recipientKey('owner', 'alice');
  try {
    const first = new Journal(new LocalState(file));
    assert.equal(await first.claim(key, '2026-10-14'), true);
    const afterCrash = new Journal(new LocalState(file));
    assert.equal(await afterCrash.claim(key, '2026-10-14'), false);
    await first.finish(key, '2026-10-14', 'sent');
    const nextRun = new Journal(new LocalState(file));
    assert.equal(await nextRun.claim(key, '2026-10-14'), false);
    assert.equal(await nextRun.claim(key, '2026-10-15'), true);
    const raw = await fs.readFile(file, 'utf8');
    assert.equal(raw.includes('alice'), false);
    assert.notEqual(key, recipientKey('anotherowner', 'alice'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('khung sáng, trưa, tối và ngày mới dùng giờ Việt Nam', () => {
  const cases = [
    ['2026-10-14T04:59:59Z', '2026-10-14', 'morning'],
    ['2026-10-14T05:00:00Z', '2026-10-14', 'noon'],
    ['2026-10-14T10:59:59Z', '2026-10-14', 'noon'],
    ['2026-10-14T11:00:00Z', '2026-10-14', 'evening'],
    ['2026-10-14T16:59:59Z', '2026-10-14', 'evening'],
    ['2026-10-14T17:00:00Z', '2026-10-15', 'morning'],
  ];
  for (const [instant, day, slot] of cases) {
    const window = sendWindow('Asia/Ho_Chi_Minh', new Date(instant));
    assert.equal(window.day, day);
    assert.equal(window.slot, slot);
  }
});

test('gửi ba khung độc lập, giữ câu luân phiên qua lần chạy lại và qua ngày', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streak-slots-'));
  const file = path.join(dir, 'state.json');
  const config = loadConfig({ ACCOUNT_USERNAME: 'owner', RECIPIENTS_JSON: '["alice"]', MESSAGES_JSON: '["fixture_one", "fixture_two", "fixture_three"]' });
  const key = recipientKey('owner', 'alice');
  const sent = [];
  try {
    for (const slot of ['morning', 'noon', 'evening']) {
      const journal = new Journal(new LocalState(file));
      const previous = (await journal.load()).entries[key];
      const selected = chooseMessage(config, config.recipients[0], previous?.lastMessageIndex, key);
      assert.equal(await journal.claim(key, '2026-10-14', slot, selected.index), true);
      await journal.finish(key, '2026-10-14', 'sent', slot);
      assert.equal(await new Journal(new LocalState(file)).claim(key, '2026-10-14', slot), false);
      sent.push(selected.message);
    }
    assert.equal(new Set(sent).size, 3);
    const nextDay = new Journal(new LocalState(file));
    const previous = (await nextDay.load()).entries[key];
    const selected = chooseMessage(config, config.recipients[0], previous.lastMessageIndex, key);
    assert.notEqual(selected.message, sent.at(-1));
    assert.equal(await nextDay.claim(key, '2026-10-15', 'morning', selected.index), true);
    assert.deepEqual(Object.keys((await nextDay.load()).entries[key].slots), ['morning']);
    const raw = await fs.readFile(file, 'utf8');
    assert.equal(JSON.parse(raw).version, 2);
    for (const privateValue of ['alice', 'owner', ...config.messages]) assert.equal(raw.includes(privateValue), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('trạng thái cũ giữ lượt đã thử ở khung sáng và không chặn khung trưa, tối', async () => {
  const key = recipientKey('owner', 'alice');
  for (const status of ['sent', 'uncertain', 'reserved', 'failed']) {
    let state = { version: 1, entries: { [key]: { day: '2026-10-14', status } } };
    const store = { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
    const journal = new Journal(store);
    assert.equal(await journal.blocked(key, '2026-10-14', 'morning'), status !== 'failed');
    assert.equal(await journal.blocked(key, '2026-10-14', 'noon'), false);
    assert.equal(await journal.claim(key, '2026-10-14', 'noon', 1), true);
    await journal.finish(key, '2026-10-14', 'sent', 'noon');
    assert.equal(state.version, 2);
    assert.equal(state.entries[key].slots.morning, status);
    assert.equal(state.entries[key].slots.noon, 'sent');
    assert.equal(await new Journal(store).blocked(key, '2026-10-14', 'evening'), false);
  }
});

test('nội dung riêng được ưu tiên và danh sách câu lỗi bị chặn', () => {
  const config = loadConfig({ ACCOUNT_USERNAME: 'owner', MESSAGE: 'legacy_fixed', MESSAGES_JSON: '["shared_one", "shared_two", "shared_one"]', RECIPIENTS_JSON: '[{"username":"alice", "messages":["private_one", "private_two"]}, {"username":"bob", "message":"fixed"}]' });
  assert.deepEqual(config.messages, ['shared_one', 'shared_two']);
  const key = recipientKey('owner', 'alice');
  assert.equal(chooseMessage(config, config.recipients[0], 0, key).message, 'private_two');
  assert.equal(chooseMessage(config, config.recipients[1], 0, key).message, 'fixed');
  for (const messages of ['[]', '[""]', '["line\\nbreak"]', '{"all":true}']) assert.throws(() => loadConfig({ MESSAGES_JSON: messages }));
  assert.throws(() => loadConfig({ RECIPIENTS_JSON: '[{"username":"alice", "message":"x", "messages":["y"]}]' }));
  assert.throws(() => loadConfig({ RECIPIENTS_JSON: '[{"username":"alice", "messages":[]}]' }));
});

test('khung hoặc bộ đếm câu bị hỏng không được tự xóa trạng thái', () => {
  const key = recipientKey('owner', 'alice');
  for (const entry of [
    { day: '2026-10-14', slots: {} },
    { day: '2026-10-14', slots: { midnight: 'sent' } },
    { day: '2026-10-14', slots: { noon: 'unknown' } },
    { day: '2026-10-14', slots: { noon: 'sent' }, lastMessageIndex: -1 },
  ]) assert.throws(() => validateState({ version: 2, entries: { [key]: entry } }));
});

test('lượt chưa xác nhận bị chặn, lỗi trước khi bấm gửi có thể thử lại', async () => {
  let state = { version: 1, entries: {} };
  const store = { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
  const key = recipientKey('owner', 'bob');
  const journal = new Journal(store);
  await journal.claim(key, '2026-10-14');
  await journal.finish(key, '2026-10-14', 'failed');
  assert.equal(await journal.claim(key, '2026-10-14'), true);
  await journal.finish(key, '2026-10-14', 'uncertain');
  assert.equal(await new Journal(store).claim(key, '2026-10-14'), false);
});

test('không đặt chỗ thành công nếu ghi GitHub lỗi hoặc mất quyền', async () => {
  const responses = [
    { status: 200, body: { ref: 'refs/heads/bot-state' } },
    { status: 404, body: {} },
    { status: 409, body: {} },
  ];
  const writes = [];
  const fetcher = async (url, options) => {
    writes.push({ url, method: options.method });
    const response = responses.shift();
    return { status: response.status, ok: response.status < 400, json: async () => response.body };
  };
  const store = new GitHubState('owner/repo', 'fixture-token', 'a'.repeat(40), fetcher);
  const journal = new Journal(store);
  const key = recipientKey('owner', 'bob');
  await assert.rejects(journal.claim(key, '2026-10-14'), /HTTP 409/);
  assert.equal(await journal.blocked(key, '2026-10-14'), false);
  assert.equal(writes.at(-1).method, 'PUT');
});

test('trạng thái hỏng dừng bot thay vì làm mất chống trùng', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streak-test-'));
  const file = path.join(dir, 'state.json');
  try {
    await fs.writeFile(file, '{broken');
    await assert.rejects(new Journal(new LocalState(file)).claim(recipientKey('owner', 'alice'), '2026-10-14'));
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
