const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { TikTok } = require('../lib/tiktok');
const { Journal } = require('../lib/state');
const { recipientKey } = require('../lib/config');

const fixture = `<!doctype html><html><body>
<nav><a href="https://www.tiktok.com/@owner">Profile</a></nav>
<aside>
<button data-index="0" data-e2e="dm-new-conversation-item" data-handle="alice"><span data-e2e="dm-new-conversation-nickname">Minh</span></button>
<button data-index="1" data-e2e="dm-new-conversation-item" data-handle="bob"><span data-e2e="dm-new-conversation-nickname">Minh</span></button>
</aside>
<section id="chat"><div data-e2e="chat-header"><a href="https://www.tiktok.com/@alice">Minh</a></div>
<div id="messages"><p>🔥</p></div>
<div class="public-DraftEditor-content" role="textbox" contenteditable="true" style="border:1px solid;height:35px"></div>
</section>
<script>
window.sent = [];
window.current = 'alice';
window.ignoreSend = false;
window.switchOnInput = false;
for (const button of document.querySelectorAll('[data-handle]')) button.onclick = () => {
  setTimeout(() => {
    window.current = button.dataset.handle;
    document.querySelector('[data-e2e="chat-header"] a').href = 'https://www.tiktok.com/@' + window.current;
    document.querySelector('[contenteditable]').innerText = '';
  }, 120);
};
const editor = document.querySelector('[contenteditable]');
editor.oninput = () => {
  if (window.switchOnInput) {
    window.current = 'alice';
    document.querySelector('[data-e2e="chat-header"] a').href = 'https://www.tiktok.com/@alice';
  }
};
editor.onkeydown = event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (window.ignoreSend) return;
  const message = editor.innerText;
  window.sent.push({ recipient: window.current, message });
  const p = document.createElement('p');
  p.innerText = message;
  document.querySelector('#messages').append(p);
  editor.innerText = '';
  document.querySelector('aside').prepend(document.querySelector('[data-handle="' + window.current + '"]'));
};
</script></body></html>`;

async function setup(iframe = false) {
  const browser = await chromium.launch({ headless: true, ...(process.env.TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TEST_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  await page.route('**/*', route => {
    if (route.request().url().includes('/test-frame')) return route.fulfill({ contentType: 'text/html', body: fixture });
    return route.fulfill({ contentType: 'text/html', body: iframe ? '<nav><a href="https://www.tiktok.com/@owner">Profile</a></nav><iframe src="https://www.tiktok.com/test-frame" style="width:100%;height:700px"></iframe>' : fixture });
  });
  const adapter = new TikTok(page, { targetUrl: 'https://www.tiktok.com/messages?lang=en', navigationTimeoutMs: 3000, confirmationTimeoutMs: 600, maxScrolls: 3, sendKey: 'Enter' });
  await adapter.open();
  return { browser, page, adapter };
}

test('dry-run chọn đúng username dù trùng tên hiển thị, không gõ hoặc gửi', async () => {
  const { browser, adapter } = await setup();
  try {
    await adapter.verifyAccount('owner');
    await adapter.selectRecipient('bob', 'Minh');
    await adapter.prepare('bob');
    assert.equal(await adapter.currentUsername(), 'bob');
    assert.deepEqual(await adapter.frame.evaluate(() => window.sent), []);
    assert.equal(await adapter.frame.locator('[contenteditable]').innerText(), '');
  } finally { await browser.close(); }
});

test('gửi đúng người trong iframe, không tính tin giống hệt đã có là thành công mới', async () => {
  const { browser, adapter } = await setup(true);
  try {
    await adapter.verifyAccount('owner');
    await adapter.selectRecipient('bob', 'Minh');
    let attempted = false;
    assert.equal(await adapter.send('bob', '🔥', () => { attempted = true; }), true);
    assert.equal(attempted, true);
    assert.deepEqual(await adapter.frame.evaluate(() => window.sent), [{ recipient: 'bob', message: '🔥' }]);
    await adapter.selectRecipient('alice');
    assert.equal(await adapter.currentUsername(), 'alice');
  } finally { await browser.close(); }
});

test('cookie sai tài khoản, người nhận sai và bản nháp có sẵn đều bị chặn', async () => {
  const { browser, adapter } = await setup();
  try {
    await assert.rejects(adapter.verifyAccount('someoneelse'), error => error.code === 'ACCOUNT_NOT_VERIFIED');
    await assert.rejects(adapter.send('bob', '🔥', () => {}), error => error.code === 'RECIPIENT_NOT_VERIFIED');
    await adapter.frame.locator('[contenteditable]').fill('bản nháp của bạn');
    await assert.rejects(adapter.prepare('alice'), error => error.code === 'DRAFT_NOT_EMPTY');
    assert.deepEqual(await adapter.frame.evaluate(() => window.sent), []);
  } finally { await browser.close(); }
});

test('chat đổi trong lúc gõ thì không bấm gửi', async () => {
  const { browser, adapter } = await setup();
  try {
    await adapter.selectRecipient('bob', 'Minh');
    await adapter.frame.evaluate(() => { window.switchOnInput = true; });
    let attempted = false;
    await assert.rejects(adapter.send('bob', '🔥', () => { attempted = true; }), error => error.code === 'RECIPIENT_CHANGED');
    assert.equal(attempted, false);
    assert.deepEqual(await adapter.frame.evaluate(() => window.sent), []);
  } finally { await browser.close(); }
});

test('bấm gửi không có tin mới thì ghi chưa rõ, workflow chạy lại không gửi lần hai', async () => {
  const { browser, adapter } = await setup();
  let state = { version: 1, entries: {} };
  const store = { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
  const key = recipientKey('owner', 'alice');
  try {
    const first = new Journal(store);
    await adapter.frame.evaluate(() => { window.ignoreSend = true; });
    await first.claim(key, '2026-10-14');
    assert.equal(await adapter.send('alice', '🔥', () => {}), false);
    await first.finish(key, '2026-10-14', 'uncertain');
    assert.equal(await new Journal(store).claim(key, '2026-10-14'), false);
    assert.deepEqual(await adapter.frame.evaluate(() => window.sent), []);
  } finally { await browser.close(); }
});
