const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, chooseMessage, recipientKey } = require('../lib/config');
const { Journal, LocalState, validateState } = require('../lib/state');

test('100 câu hợp lệ từ file, biến chung và danh sách riêng đều được giữ đủ', async () => {
  const messages = Array.from({ length: 100 }, (_, i) => `fixture_message_${i}`);
  const env = { ACCOUNT_USERNAME: 'owner', RECIPIENTS_JSON: '["alice"]' };
  const globalPool = loadConfig({ ...env, MESSAGES_JSON: JSON.stringify(messages) });
  assert.deepEqual(globalPool.messages, messages);
  const personal = loadConfig({ ...env, RECIPIENTS_JSON: JSON.stringify([{ username: 'alice', messages }]) });
  assert.deepEqual(personal.recipients[0].messages, messages);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streak-pool-config-'));
  try {
    const file = path.join(dir, 'config.json');
    await fs.writeFile(file, JSON.stringify({ accountUsername: 'owner', recipients: ['alice'], messages }));
    assert.deepEqual(loadConfig({}, file).messages, messages);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('100 câu luân phiên qua vị trí 49→50 và 99→0 sau khi khởi động lại, vẫn chặn lượt đã gửi', async () => {
  const messages = Array.from({ length: 100 }, (_, i) => `fixture_message_${i}`);
  const config = loadConfig({ ACCOUNT_USERNAME: 'owner', RECIPIENTS_JSON: '["alice"]', MESSAGES_JSON: JSON.stringify(messages) });
  const key = recipientKey('owner', 'alice');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streak-pool-state-'));
  const file = path.join(dir, 'state.json');
  try {
    await fs.writeFile(file, JSON.stringify({ version: 2, entries: { [key]: { day: '2026-10-14', slots: { morning: 'sent' }, lastMessageIndex: 49 } } }));
    const selectedMessages = [];
    for (let i = 0; i < 100; i++) {
      const day = new Date(Date.UTC(2026, 9, 15 + i)).toISOString().slice(0, 10);
      const journal = new Journal(new LocalState(file));
      const previous = (await journal.load()).entries[key];
      const selected = chooseMessage(config, config.recipients[0], previous.lastMessageIndex, key);
      if (i === 0) assert.equal(selected.index, 50);
      if (i === 49) assert.equal(selected.index, 99);
      if (i === 50) assert.equal(selected.index, 0);
      assert.equal(await journal.claim(key, day, 'morning', selected.index), true);
      await journal.finish(key, day, 'sent');
      const restarted = new Journal(new LocalState(file));
      assert.equal((await restarted.load()).entries[key].lastMessageIndex, selected.index);
      assert.equal(await restarted.claim(key, day, 'morning', selected.index), false);
      selectedMessages.push(selected.message);
    }
    assert.deepEqual(new Set(selectedMessages), new Set(messages));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('giới hạn 1000 câu khớp với trạng thái lưu vị trí câu cuối', () => {
  const messages = Array.from({ length: 1000 }, (_, i) => `fixture_message_${i}`);
  const env = { ACCOUNT_USERNAME: 'owner', RECIPIENTS_JSON: '["alice"]', MESSAGES_JSON: JSON.stringify(messages) };
  const config = loadConfig(env);
  assert.equal(config.messages.length, 1000);
  const key = recipientKey('owner', 'alice');
  const state = { version: 2, entries: { [key]: { day: '2026-10-15', slots: { noon: 'sent' }, lastMessageIndex: 999 } } };
  assert.equal(validateState(state).entries[key].lastMessageIndex, 999);
  assert.equal(chooseMessage(config, config.recipients[0], 999, key).index, 0);
  state.entries[key].lastMessageIndex = 1000;
  assert.throws(() => validateState(state), /Vị trí câu/);
  assert.throws(() => loadConfig({ ...env, MESSAGES_JSON: JSON.stringify([...messages, 'fixture_over_limit']) }), /1–1000 câu/);
});
