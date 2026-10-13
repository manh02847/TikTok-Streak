const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { username, loadConfig, normalizeCookies, localDay, recipientKey } = require('../lib/config');
const { Journal, LocalState, GitHubState } = require('../lib/state');

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

test('ngày chống trùng đổi lúc nửa đêm Việt Nam thay vì UTC', () => {
  assert.equal(localDay('Asia/Ho_Chi_Minh', new Date('2026-10-13T16:59:59Z')), '2026-10-13');
  assert.equal(localDay('Asia/Ho_Chi_Minh', new Date('2026-10-13T17:00:00Z')), '2026-10-14');
});

test('gửi xong hoặc runner chết sau khi đặt chỗ vẫn không gửi lại cùng ngày', async () => {
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
