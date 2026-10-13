const defaults = {
  item: '[data-e2e="dm-new-conversation-item"], [data-e2e="chat-list-item"]',
  name: '[data-e2e="dm-new-conversation-nickname"]',
  header: '[data-e2e="chat-header"], [class*="ChatHeader"], [class*="chatHeader"]',
  editor: '.public-DraftEditor-content[contenteditable="true"], [class*="DraftEditor-editorContainer"] [contenteditable="true"], [contenteditable="true"][role="textbox"]',
  selfProfile: 'nav a[href*="/@"], [data-e2e="nav-profile"][href*="/@"], [data-e2e="nav-profile"] a[href*="/@"], [data-e2e="profile-icon"] a[href*="/@"]',
};

function failure(code) { return Object.assign(new Error(code), { code }); }

function chatIdentity({ header, editor }) {
  const visible = element => !!element && element.getClientRects().length > 0;
  const editors = Array.from(document.querySelectorAll(editor)).filter(visible);
  const headers = Array.from(document.querySelectorAll(header)).filter(visible);
  const handles = new Set();
  let pane = null;
  for (const node of headers) {
    for (const link of Array.from(node.querySelectorAll('a[href*="/@"]')).filter(visible)) {
      const url = new URL(link.href, location.href);
      const match = url.pathname.match(/^\/@([a-zA-Z0-9_.]{1,24})\/?$/);
      if (match && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname)) handles.add(match[1].toLowerCase());
    }
    if (!pane && editors.length === 1) {
      let ancestor = node.parentElement;
      while (ancestor && !ancestor.contains(editors[0])) ancestor = ancestor.parentElement;
      if (ancestor) pane = ancestor;
    }
  }
  return { handles: Array.from(handles), hasEditor: editors.length === 1, hasPane: !!pane };
}

function messageSnapshot({ selectors, message }) {
  const visible = element => element.getClientRects().length > 0;
  const editors = Array.from(document.querySelectorAll(selectors.editor)).filter(visible);
  const candidates = Array.from(document.querySelectorAll(selectors.header)).filter(node => visible(node) && node.querySelector('a[href*="/@"]'));
  const headers = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)));
  if (editors.length !== 1 || headers.length !== 1) return { count: -1, draft: null };
  const editor = editors[0];
  const header = headers[0];
  let pane = header.parentElement;
  while (pane && !pane.contains(editor)) pane = pane.parentElement;
  if (!pane) return { count: -1, draft: null };
  const nodes = Array.from(pane.querySelectorAll('p, span, div')).filter(node =>
    visible(node) && !editor.contains(node) && !node.contains(editor) && !header.contains(node) &&
    !node.closest(selectors.item) && node.innerText?.trim() === message &&
    !Array.from(node.children).some(child => child.innerText?.trim() === message)
  );
  return { count: nodes.length, draft: editor.innerText.trim() };
}

class TikTok {
  constructor(page, config) {
    this.page = page;
    this.config = config;
    this.selectors = { ...defaults, ...config.selectors };
    this.frame = page.mainFrame();
    this.scanned = new Map();
    page.setDefaultTimeout(config.navigationTimeoutMs);
  }
  async guard() {
    for (const frame of this.page.frames()) {
      const state = await frame.evaluate(() => ({
        text: document.body?.innerText?.slice(0, 10000) || '',
        challenge: Array.from(document.querySelectorAll('iframe')).some(node => /captcha|verify|challenge/i.test(`${node.title} ${node.getAttribute('src') || ''}`) && node.getClientRects().length > 0),
      })).catch(() => ({ text: '', challenge: false }));
      if (state.challenge || /verify you are human|unusual traffic|automated requests|complete the captcha/i.test(state.text)) throw failure('BOT_BLOCKED');
      if (/\/login(?:[/?]|$)/.test(this.page.url())) throw failure('AUTH_REQUIRED');
    }
  }
  async open() {
    await this.page.goto(this.config.targetUrl, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + this.config.navigationTimeoutMs;
    while (Date.now() < deadline) {
      await this.guard();
      for (const frame of this.page.frames()) {
        if (await frame.locator(this.selectors.item).count()) { this.frame = frame; return; }
      }
      await this.page.waitForTimeout(300);
    }
    throw failure('INBOX_NOT_FOUND');
  }
  async verifyAccount(expected) {
    const accounts = new Set();
    for (const frame of this.page.frames()) {
      const values = await frame.locator(this.selectors.selfProfile).evaluateAll(nodes => nodes.map(node => node.href));
      for (const value of values) {
        const url = new URL(value);
        const match = url.pathname.match(/^\/@([a-zA-Z0-9_.]{1,24})\/?$/);
        if (match && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname)) accounts.add(match[1].toLowerCase());
      }
    }
    if (accounts.size !== 1 || !accounts.has(expected)) throw failure('ACCOUNT_NOT_VERIFIED');
  }
  async identity() { return this.frame.evaluate(chatIdentity, this.selectors); }
  async currentUsername() {
    const identity = await this.identity();
    return identity.handles.length === 1 ? identity.handles[0] : null;
  }
  async scroll(reset = false) {
    return this.frame.evaluate(({ item, reset }) => {
      let container = document.querySelector(item)?.parentElement;
      while (container && container !== document.body && container.scrollHeight <= container.clientHeight + 2) container = container.parentElement;
      if (!container || container === document.body) return false;
      const before = container.scrollTop;
      container.scrollTop = reset ? 0 : before + Math.max(100, container.clientHeight * 0.8);
      return reset || container.scrollTop > before;
    }, { item: this.selectors.item, reset });
  }
  async selectRecipient(expected, chatName) {
    await this.guard();
    if (await this.currentUsername() === expected) return;
    await this.scroll(true);
    await this.page.waitForTimeout(150);
    const seen = new Set();
    for (let scroll = 0; scroll < this.config.maxScrolls; scroll++) {
      const items = this.frame.locator(this.selectors.item);
      const candidates = [];
      for (let i = 0; i < await items.count(); i++) {
        const item = items.nth(i);
        const fingerprint = await item.evaluate(node => `${node.getAttribute('data-index') || node.parentElement?.getAttribute('data-index') || ''}|${node.textContent}`);
        const nickname = item.locator(this.selectors.name).first();
        const name = await nickname.count() ? await nickname.innerText({ timeout: 500 }).catch(() => '') : '';
        candidates.push({ i, fingerprint, priority: chatName && name.trim() === chatName ? 0 : 1 });
      }
      candidates.sort((a, b) => a.priority - b.priority);
      for (const candidate of candidates) {
        if (seen.has(candidate.fingerprint)) continue;
        seen.add(candidate.fingerprint);
        const item = this.frame.locator(this.selectors.item).nth(candidate.i);
        const fresh = await item.evaluate(node => `${node.getAttribute('data-index') || node.parentElement?.getAttribute('data-index') || ''}|${node.textContent}`).catch(() => null);
        if (fresh !== candidate.fingerprint) continue;
        const before = await this.currentUsername();
        await item.click();
        try {
          await this.frame.waitForFunction(({ selectors, before }) => {
            const headers = Array.from(document.querySelectorAll(selectors.header)).filter(node => node.getClientRects().length);
            const handles = new Set();
            for (const header of headers) for (const link of header.querySelectorAll('a[href*="/@"]')) {
              const url = new URL(link.href, location.href);
              const match = url.pathname.match(/^\/@([a-zA-Z0-9_.]{1,24})\/?$/);
              if (match && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname)) handles.add(match[1].toLowerCase());
            }
            return handles.size === 1 && !handles.has(before);
          }, { selectors: this.selectors, before }, { timeout: 2500 });
        } catch { continue; }
        const actual = await this.currentUsername();
        this.scanned.set(candidate.fingerprint, actual);
        if (actual === expected) return;
      }
      if (!await this.scroll()) break;
      await this.page.waitForTimeout(350);
    }
    throw failure('RECIPIENT_NOT_FOUND');
  }
  async prepare(expected) {
    await this.guard();
    const identity = await this.identity();
    if (identity.handles.length !== 1 || identity.handles[0] !== expected || !identity.hasEditor || !identity.hasPane) throw failure('RECIPIENT_NOT_VERIFIED');
    const editor = this.frame.locator(this.selectors.editor);
    if ((await editor.innerText()).trim()) throw failure('DRAFT_NOT_EMPTY');
    return editor;
  }
  async send(expected, message, markAttempt) {
    const editor = await this.prepare(expected);
    const before = await this.frame.evaluate(messageSnapshot, { selectors: this.selectors, message });
    if (before.count < 0) throw failure('CHAT_LAYOUT_NOT_VERIFIED');
    await editor.click();
    await this.page.keyboard.insertText(message);
    if ((await editor.innerText()).trim() !== message) throw failure('DRAFT_NOT_VERIFIED');
    await this.guard();
    if (await this.currentUsername() !== expected) throw failure('RECIPIENT_CHANGED');
    markAttempt();
    await editor.press(this.config.sendKey);
    const deadline = Date.now() + this.config.confirmationTimeoutMs;
    while (Date.now() < deadline) {
      await this.guard();
      if (await this.currentUsername() !== expected) return false;
      const after = await this.frame.evaluate(messageSnapshot, { selectors: this.selectors, message });
      if (after.count > before.count && after.draft === '') return true;
      await this.page.waitForTimeout(250);
    }
    return false;
  }
}

module.exports = { TikTok, defaults, chatIdentity, messageSnapshot };
