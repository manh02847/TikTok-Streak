const defaults = {
  item: '[data-e2e="dm-new-conversation-item"], [data-e2e="chat-list-item"]',
  name: '[data-e2e="dm-new-conversation-nickname"]',
  header: '[data-e2e="chat-header"], [class*="ChatHeader"], [class*="chatHeader"]',
  editor: '.public-DraftEditor-content[contenteditable="true"], [class*="DraftEditor-editorContainer"] [contenteditable="true"], [contenteditable="true"][role="textbox"]',
  selfProfile: 'nav a[href*="/@"], [data-e2e="nav-profile"][href*="/@"], [data-e2e="nav-profile"] a[href*="/@"], [data-e2e="profile-icon"] a[href*="/@"]',
};

function failure(code) { return Object.assign(new Error(code), { code }); }

function conversationRows(selectors) {
  const occurrences = new Map();
  return Array.from(document.querySelectorAll(selectors.item)).flatMap((node, index) => {
    if (!node.getClientRects().length || !node.textContent.trim()) return [];
    const name = node.querySelector(selectors.name)?.textContent.trim() || '';
    const handles = new Set();
    for (const link of node.querySelectorAll('a[href*="/@"]')) {
      const url = new URL(link.href, location.href);
      const match = url.pathname.match(/^\/@([a-zA-Z0-9_.]{1,24})\/?$/);
      if (match && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname)) handles.add(match[1].toLowerCase());
    }
    const fingerprint = JSON.stringify([
      node.getAttribute('data-conversation-id'),
      node.getAttribute('data-index') || node.parentElement?.getAttribute('data-index'),
      Array.from(handles).sort(), name, node.querySelector('img')?.getAttribute('src'), node.textContent,
    ]);
    const occurrence = occurrences.get(fingerprint) || 0;
    occurrences.set(fingerprint, occurrence + 1);
    return [{ index, key: `${fingerprint}|${occurrence}`, name, handles: Array.from(handles) }];
  });
}

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
    this.recipientHints = new Map();
    page.setDefaultTimeout(config.navigationTimeoutMs);
  }
  async guard() {
    if (/\/login(?:[/?]|$)/.test(this.page.url())) throw failure('AUTH_REQUIRED');
    for (const frame of this.page.frames()) {
      const state = await frame.evaluate(() => ({
        text: document.body?.innerText?.slice(0, 10000) || '',
        challenge: Array.from(document.querySelectorAll('iframe')).some(node => /captcha|verify|challenge/i.test(`${node.title} ${node.getAttribute('src') || ''}`) && node.getClientRects().length > 0),
        login: Array.from(document.querySelectorAll('dialog, [role="dialog"], form, h1, h2')).some(node => node.getClientRects().length > 0 && /log in to tiktok|sign in to tiktok|log in to send messages|your session has expired/i.test(node.innerText || '')),
      })).catch(() => ({ text: '', challenge: false, login: false }));
      if (state.challenge || /verify you are human|unusual traffic|automated requests|complete the captcha/i.test(state.text)) throw failure('BOT_BLOCKED');
      if (state.login) throw failure('AUTH_REQUIRED');
    }
  }
  async open() {
    await this.page.goto(this.config.targetUrl, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + this.config.navigationTimeoutMs;
    while (Date.now() < deadline) {
      await this.guard();
      for (const frame of this.page.frames()) {
        if ((await frame.evaluate(conversationRows, this.selectors)).length) { this.frame = frame; return; }
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
      let container = Array.from(document.querySelectorAll(item)).find(node => node.getClientRects().length)?.parentElement;
      while (container && container !== document.body && container.scrollHeight <= container.clientHeight + 2) container = container.parentElement;
      if (!container || container === document.body) return false;
      const before = container.scrollTop;
      container.scrollTop = reset ? 0 : before + Math.max(100, container.clientHeight * 0.8);
      return reset || container.scrollTop > before;
    }, { item: this.selectors.item, reset });
  }
  async waitForSelection(expected, before, deadline) {
    let stable = null;
    let stableSince = 0;
    while (Date.now() < deadline) {
      await this.guard();
      const identity = await this.identity();
      const actual = identity.handles.length === 1 ? identity.handles[0] : null;
      if (actual && identity.hasEditor && identity.hasPane && (actual === expected || actual !== before)) {
        if (actual !== stable) { stable = actual; stableSince = Date.now(); }
        if (Date.now() - stableSince >= 150) return actual;
      } else stable = null;
      await this.page.waitForTimeout(100);
    }
    return null;
  }
  async selectRecipient(expected, chatName) {
    const deadline = Date.now() + this.config.navigationTimeoutMs;
    const search = { rows: 0, clicks: 0, passes: 0, scrolls: 0 };
    const hint = chatName || this.recipientHints.get(expected);
    const priority = row => row.handles.includes(expected) ? 0 : this.scanned.get(row.key) === expected ? 1 : hint && row.name === hint ? 2 : row.name.replace(/^@/, '').toLowerCase() === expected ? 3 : 4;
    for (let pass = 0; pass < 3 && Date.now() < deadline; pass++) {
      search.passes++;
      await this.guard();
      await this.scroll(true);
      await this.page.waitForTimeout(150);
      const seen = new Set();
      let idle = 0;
      let scrolls = 0;
      while (scrolls < this.config.maxScrolls && Date.now() < deadline) {
        await this.guard();
        const identity = await this.identity();
        if (identity.handles.length === 1 && identity.handles[0] === expected && identity.hasEditor && identity.hasPane) return;
        const rows = await this.frame.evaluate(conversationRows, this.selectors);
        search.rows = Math.max(search.rows, rows.length);
        const candidate = rows.filter(row => !seen.has(row.key)).sort((a, b) => priority(a) - priority(b))[0];
        if (candidate) {
          const fresh = (await this.frame.evaluate(conversationRows, this.selectors)).find(row => row.index === candidate.index);
          if (!fresh || fresh.key !== candidate.key) continue;
          const before = await this.currentUsername();
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          try {
            await this.frame.locator(this.selectors.item).nth(candidate.index).click({ timeout: Math.min(5000, remaining) });
          } catch (error) {
            await this.guard();
            if (error.name !== 'TimeoutError') throw error;
            seen.add(candidate.key);
            continue;
          }
          search.clicks++;
          seen.add(candidate.key);
          const waitMs = Math.min(5000, Math.max(500, Math.floor(this.config.navigationTimeoutMs / 3)));
          const actual = await this.waitForSelection(expected, before, Math.min(deadline, Date.now() + waitMs));
          if (actual) {
            this.scanned.set(candidate.key, actual);
            if (candidate.name) this.recipientHints.set(actual, candidate.name);
            if (actual === expected) return;
          }
          idle = 0;
          continue;
        }
        if (await this.scroll()) {
          scrolls++;
          search.scrolls++;
          idle = 0;
        } else if (++idle > 2) break;
        await this.page.waitForTimeout(350);
      }
    }
    throw Object.assign(failure('RECIPIENT_NOT_FOUND'), { search });
  }
  async prepare(expected) {
    await this.guard();
    const identity = await this.identity();
    if (identity.handles.length !== 1 || identity.handles[0] !== expected || !identity.hasEditor || !identity.hasPane) throw failure('RECIPIENT_NOT_VERIFIED');
    const editor = this.frame.locator(this.selectors.editor);
    if ((await editor.innerText()).trim()) throw failure('DRAFT_NOT_EMPTY');
    return editor;
  }
  async confirmHistory(expected, message, before) {
    await this.open();
    await this.verifyAccount(this.config.accountUsername);
    try {
      await this.selectRecipient(expected);
    } catch (error) {
      if (error.code === 'RECIPIENT_NOT_FOUND') throw Object.assign(failure('HISTORY_RECIPIENT_NOT_FOUND'), { search: error.search });
      throw error;
    }
    const deadline = Date.now() + this.config.confirmationTimeoutMs;
    while (Date.now() < deadline) {
      await this.guard();
      if (await this.currentUsername() !== expected) return false;
      const history = await this.frame.evaluate(messageSnapshot, { selectors: this.selectors, message });
      if (history.count > before.count && history.draft === '') {
        await this.verifyAccount(this.config.accountUsername);
        return true;
      }
      await this.page.waitForTimeout(250);
    }
    return false;
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
    const pending = new Set();
    const started = request => {
      if (['POST', 'PUT', 'PATCH'].includes(request.method()) && ['fetch', 'xhr'].includes(request.resourceType())) pending.add(request);
    };
    const settled = request => pending.delete(request);
    this.page.on('request', started);
    this.page.on('requestfinished', settled);
    this.page.on('requestfailed', settled);
    try {
      markAttempt();
      await editor.press(this.config.sendKey);
      const deadline = Date.now() + this.config.confirmationTimeoutMs;
      const stableMs = Math.min(2000, Math.floor(this.config.confirmationTimeoutMs / 2));
      let visibleSince = null;
      while (Date.now() < deadline) {
        await this.guard();
        if (await this.currentUsername() !== expected) return false;
        const after = await this.frame.evaluate(messageSnapshot, { selectors: this.selectors, message });
        if (after.count > before.count && after.draft === '') {
          visibleSince ??= Date.now();
          if (!pending.size && Date.now() - visibleSince >= stableMs) return await this.confirmHistory(expected, message, before);
        } else visibleSince = null;
        await this.page.waitForTimeout(250);
      }
      return false;
    } finally {
      this.page.off('request', started);
      this.page.off('requestfinished', settled);
      this.page.off('requestfailed', settled);
    }
  }
}

module.exports = { TikTok, defaults, chatIdentity, messageSnapshot };
