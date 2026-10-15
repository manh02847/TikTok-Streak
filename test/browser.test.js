const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { TikTok, messageSnapshot } = require('../lib/tiktok');
const { Journal } = require('../lib/state');
const { recipientKey } = require('../lib/config');

const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
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
window.sent = __SERVER_SENT__;
window.histories = __SERVER_HISTORY__;
window.current = __INITIAL_CURRENT__;
document.querySelector('[data-e2e="chat-header"] a').href = 'https://www.tiktok.com/@' + window.current;
window.selectionDelay = __SELECTION_DELAY__;
window.reorderOnSelect = __REORDER_ON_SELECT__;
window.ignoreSend = false;
window.switchOnInput = false;
function renderHistory() {
  const container = document.querySelector('#messages');
  container.replaceChildren();
  for (const message of window.histories[window.current]) {
    const p = document.createElement('p');
    p.innerText = message;
    container.append(p);
  }
}
renderHistory();
for (const button of document.querySelectorAll('[data-handle]')) button.onclick = () => {
  setTimeout(() => {
    window.current = button.dataset.handle;
    document.querySelector('[data-e2e="chat-header"] a').href = 'https://www.tiktok.com/@' + window.current;
    document.querySelector('[contenteditable]').innerText = '';
    renderHistory();
    if (window.reorderOnSelect && window.current === 'alice') document.querySelector('aside').prepend(document.querySelector('[data-handle="bob"]'));
  }, button.dataset.handle === 'bob' ? window.selectionDelay : 120);
};
const bobRow = document.querySelector('[data-handle="bob"]');
if (__LIST_DELAY__ > 0) {
  bobRow.remove();
  setTimeout(() => document.querySelector('aside').append(bobRow), __LIST_DELAY__);
}
if (__HIDE_BOB__) bobRow.remove();
const editor = document.querySelector('[contenteditable]');
editor.oninput = () => {
  if (window.switchOnInput) {
    window.current = 'alice';
    document.querySelector('[data-e2e="chat-header"] a').href = 'https://www.tiktok.com/@alice';
  }
};
editor.onkeydown = async event => {
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
  const response = await fetch('/test-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: window.current, message }) });
  if (response.ok) window.histories[window.current].push(message);
};
</script></body></html>`;

async function setup(iframe = false, outcome = 'saved', options = {}) {
  const browser = await chromium.launch({ headless: true, ...(process.env.TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TEST_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const server = { histories: { alice: ['🔥'], bob: ['🔥'], carol: ['🔥'] }, sent: [], attempts: 0, loggedOut: false, loads: 0 };
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/test-send' && request.method() === 'POST') {
      server.attempts++;
      const sent = request.postDataJSON();
      if (!['saved', 'slow'].includes(outcome)) {
        if (outcome === 'logout') server.loggedOut = true;
        return route.fulfill({ status: outcome === 'logout' ? 401 : 503, contentType: 'application/json', body: '{}' });
      }
      if (outcome === 'slow') await new Promise(resolve => setTimeout(resolve, 1200));
      server.histories[sent.recipient].push(sent.message);
      server.sent.push(sent);
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    if (url.pathname === '/login') return route.fulfill({ contentType: 'text/html', body: '<h1>Log in to TikTok</h1>' });
    if (server.loggedOut) return route.fulfill({ contentType: 'text/html', body: '<div role="dialog"><h1>Log in to TikTok</h1></div>' });
    if (url.pathname !== '/test-frame') server.loads++;
    const listDelay = options.listDelay || (server.loads > 1 ? options.historyListDelay || 0 : 0);
    const body = fixture.replace('__SERVER_SENT__', JSON.stringify(server.sent)).replace('__SERVER_HISTORY__', JSON.stringify(server.histories))
      .replace('__INITIAL_CURRENT__', JSON.stringify(options.reorderOnSelect ? 'carol' : 'alice'))
      .replace('__SELECTION_DELAY__', JSON.stringify(options.selectionDelay || 120))
      .replace('__REORDER_ON_SELECT__', JSON.stringify(!!options.reorderOnSelect))
      .replaceAll('__LIST_DELAY__', JSON.stringify(listDelay))
      .replace('__HIDE_BOB__', JSON.stringify(!!options.historyHideBob && server.loads > 1));
    if (url.pathname === '/test-frame') return route.fulfill({ contentType: 'text/html', body });
    return route.fulfill({ contentType: 'text/html', body: iframe ? '<nav><a href="https://www.tiktok.com/@owner">Profile</a></nav><iframe src="https://www.tiktok.com/test-frame" style="width:100%;height:700px"></iframe>' : body });
  });
  const adapter = new TikTok(page, { accountUsername: 'owner', targetUrl: 'https://www.tiktok.com/messages?lang=en', navigationTimeoutMs: options.navigationTimeoutMs || 3000, confirmationTimeoutMs: 600, maxScrolls: 3, sendKey: 'Enter' });
  await adapter.open();
  return { browser, page, adapter, server };
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
  const { browser, adapter, server } = await setup(true);
  try {
    await adapter.verifyAccount('owner');
    await adapter.selectRecipient('bob', 'Minh');
    assert.equal((await adapter.frame.evaluate(messageSnapshot, { selectors: adapter.selectors, message: '🔥' })).count, 1);
    let attempted = false;
    const result = await adapter.send('bob', '🔥', () => { attempted = true; });
    assert.equal(result, true, JSON.stringify({ server, history: await adapter.frame.evaluate(messageSnapshot, { selectors: adapter.selectors, message: '🔥' }) }));
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

test('tin chỉ hiện tạm nhưng không có trên lịch sử sau khi mở lại không được tính là gửi thành công', async () => {
  const { browser, adapter, server } = await setup(false, 'optimistic');
  let state = { version: 1, entries: {} };
  const store = { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
  const key = recipientKey('owner', 'alice');
  try {
    const journal = new Journal(store);
    await journal.claim(key, '2026-10-14');
    assert.equal(await adapter.send('alice', '🔥', () => {}), false);
    await journal.finish(key, '2026-10-14', 'uncertain');
    assert.equal(server.attempts, 1);
    assert.deepEqual(server.sent, []);
    assert.equal(await new Journal(store).claim(key, '2026-10-14'), false);
  } finally { await browser.close(); }
});

test('mất phiên sau khi hiện tin tạm phải báo AUTH_REQUIRED và giữ lượt chưa xác nhận', async () => {
  const { browser, adapter, server } = await setup(false, 'logout');
  let state = { version: 1, entries: {} };
  const store = { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
  const key = recipientKey('owner', 'alice');
  try {
    const journal = new Journal(store);
    await journal.claim(key, '2026-10-14');
    let attempted = false;
    await assert.rejects(adapter.send('alice', '🔥', () => { attempted = true; }), error => error.code === 'AUTH_REQUIRED');
    assert.equal(attempted, true);
    await journal.finish(key, '2026-10-14', 'uncertain');
    assert.equal(server.attempts, 1);
    assert.deepEqual(server.sent, []);
    assert.equal((await store.load()).entries[key].slots.morning, 'uncertain');
    assert.equal(await new Journal(store).claim(key, '2026-10-14'), false);
  } finally { await browser.close(); }
});

test('không mở lại trang giữa lúc yêu cầu gửi còn đang xử lý', async () => {
  const { browser, adapter, server } = await setup(false, 'slow');
  adapter.config.confirmationTimeoutMs = 2000;
  try {
    const result = await adapter.send('alice', '🔥', () => {});
    assert.equal(result, true, JSON.stringify({ server, history: await adapter.frame.evaluate(messageSnapshot, { selectors: adapter.selectors, message: '🔥' }) }));
    assert.equal(server.attempts, 1);
    assert.deepEqual(server.sent, [{ recipient: 'alice', message: '🔥' }]);
  } finally { await browser.close(); }
});

test('danh sách tải thêm người sau hàng đầu tiên vẫn tìm được người nhận', async () => {
  const { browser, adapter, server } = await setup(false, 'saved', { listDelay: 300 });
  try {
    await adapter.selectRecipient('bob');
    await adapter.prepare('bob');
    assert.equal(server.attempts, 0);
  } finally { await browser.close(); }
});

test('danh sách đổi thứ tự khi chọn chat không làm bỏ mất người nhận', async () => {
  const { browser, adapter, server } = await setup(false, 'saved', { reorderOnSelect: true });
  try {
    await adapter.selectRecipient('bob');
    await adapter.prepare('bob');
    assert.equal(server.attempts, 0);
  } finally { await browser.close(); }
});

test('chat tải lâu hơn 2,5 giây được chờ trong giới hạn điều hướng', async () => {
  const { browser, adapter, server } = await setup(false, 'saved', { selectionDelay: 3200, navigationTimeoutMs: 15000 });
  try {
    await adapter.selectRecipient('bob');
    await adapter.prepare('bob');
    assert.equal(server.attempts, 0);
  } finally { await browser.close(); }
});

test('tìm lại chat tải chậm sau khi gửi chỉ bấm gửi một lần', async () => {
  const { browser, adapter, server } = await setup(false, 'saved', { historyListDelay: 400 });
  try {
    await adapter.selectRecipient('bob');
    assert.equal(await adapter.send('bob', '🔥', () => {}), true);
    assert.equal(server.attempts, 1);
    assert.deepEqual(server.sent, [{ recipient: 'bob', message: '🔥' }]);
  } finally { await browser.close(); }
});

test('chat mất sau gửi báo lỗi bước lịch sử và giữ uncertain để tránh gửi trùng', async () => {
  const { browser, adapter, server } = await setup(false, 'saved', { historyHideBob: true, navigationTimeoutMs: 1800 });
  let state = { version: 2, entries: {} };
  const journal = new Journal({ load: async () => structuredClone(state), save: async next => { state = structuredClone(next); } });
  const key = recipientKey('owner', 'bob');
  try {
    await adapter.selectRecipient('bob');
    await journal.claim(key, '2026-10-15', 'evening', 1);
    let attempted = false;
    await assert.rejects(adapter.send('bob', '🔥', () => { attempted = true; }), error => {
      assert.equal(error.code, 'HISTORY_RECIPIENT_NOT_FOUND');
      assert.equal(error.search.rows, 1);
      assert.ok(error.search.clicks > 0);
      return true;
    });
    assert.equal(attempted, true);
    await journal.finish(key, '2026-10-15', 'uncertain', 'evening');
    assert.equal(await journal.claim(key, '2026-10-15', 'evening'), false);
    assert.equal(server.attempts, 1);
  } finally { await browser.close(); }
});
