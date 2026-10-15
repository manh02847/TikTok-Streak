const fs = require('node:fs');
const crypto = require('node:crypto');
const { MAX_MESSAGES } = require('./limits');

function username(value) {
  if (typeof value !== 'string') throw new Error('Username phải là chuỗi.');
  let text = value.trim();
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    if (!['tiktok.com', 'www.tiktok.com'].includes(url.hostname) || !/^\/@[^/]+\/?$/.test(url.pathname)) throw new Error('Chỉ nhận link hồ sơ TikTok.');
    text = url.pathname.slice(2).replace(/\/$/, '');
  }
  text = text.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_.]{1,24}$/.test(text)) throw new Error('Username TikTok không hợp lệ.');
  return text;
}

function bool(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('Giá trị bật/tắt phải là true hoặc false.');
}

function parseJson(text, name) {
  try { return JSON.parse(text); } catch { throw new Error(`${name} không phải JSON hợp lệ.`); }
}

function messagePool(values, name) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_MESSAGES) throw new Error(`${name} phải là mảng 1–${MAX_MESSAGES} câu.`);
  const messages = values.map(value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\r\n]/.test(value)) throw new Error(`${name}: mỗi câu phải có 1–500 ký tự trên một dòng.`);
    return value.trim();
  });
  return [...new Set(messages)];
}

function loadConfig(env = process.env, file = 'config.json') {
  const config = parseJson(fs.readFileSync(file, 'utf8'), 'config.json');
  config.enabled = bool(env.BOT_ENABLED, bool(config.enabled, false));
  config.headless = bool(env.HEADLESS, bool(config.headless, true));
  config.accountUsername = env.ACCOUNT_USERNAME || config.accountUsername || '';
  if (config.accountUsername) config.accountUsername = username(config.accountUsername);
  config.timeZone = config.timeZone || 'Asia/Ho_Chi_Minh';
  new Intl.DateTimeFormat('en', { timeZone: config.timeZone }).format(new Date());
  config.messages = messagePool(env.MESSAGES_JSON ? parseJson(env.MESSAGES_JSON, 'MESSAGES_JSON') : env.MESSAGE ? [env.MESSAGE] : config.messages || [config.message || '🔥'], 'Danh sách tin nhắn');
  config.message = config.messages[0];
  const recipients = env.RECIPIENTS_JSON ? parseJson(env.RECIPIENTS_JSON, 'RECIPIENTS_JSON') : (config.recipients || []);
  if (!Array.isArray(recipients) || recipients.length > 200) throw new Error('Danh sách người nhận phải là mảng, tối đa 200 người.');
  const seen = new Set();
  config.recipients = recipients.map(item => {
    const record = typeof item === 'string' ? { username: item } : item;
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Người nhận không hợp lệ.');
    const handle = username(record.username);
    if (handle === config.accountUsername) throw new Error('Không gửi cho chính tài khoản đang chạy.');
    if (record.message !== undefined && record.messages !== undefined) throw new Error('Mỗi người chỉ dùng message hoặc messages.');
    const message = record.message === undefined ? undefined : messagePool([record.message], 'Tin nhắn riêng')[0];
    const messages = record.messages === undefined ? undefined : messagePool(record.messages, 'Danh sách tin nhắn riêng');
    if (record.chatName !== undefined && typeof record.chatName !== 'string') throw new Error('chatName phải là chuỗi.');
    return { ...record, username: handle, ...(message === undefined ? {} : { message }), ...(messages === undefined ? {} : { messages }) };
  }).filter(record => !seen.has(record.username) && seen.add(record.username));
  const url = new URL(config.targetUrl || 'https://www.tiktok.com/messages?lang=en');
  if (url.protocol !== 'https:' || !['tiktok.com', 'www.tiktok.com'].includes(url.hostname) || !['/messages', '/business-suite/messages'].includes(url.pathname)) throw new Error('targetUrl phải là trang tin nhắn HTTPS của TikTok.');
  config.targetUrl = url.toString();
  for (const [name, fallback, low, high] of [['betweenRecipientsMs', 6000, 1000, 60000], ['maxScrolls', 80, 1, 200], ['navigationTimeoutMs', 45000, 1000, 120000], ['confirmationTimeoutMs', 15000, 500, 60000]]) {
    config[name] = config[name] ?? fallback;
    if (!Number.isInteger(config[name]) || config[name] < low || config[name] > high) throw new Error(`${name} vượt giới hạn.`);
  }
  config.sendKey = config.sendKey || 'Enter';
  if (!['Enter', 'Control+Enter'].includes(config.sendKey)) throw new Error('sendKey không hợp lệ.');
  return config;
}

function normalizeCookies(data, now = Date.now() / 1000) {
  const list = Array.isArray(data) ? data : data?.cookies;
  if (!Array.isArray(list) || !list.length) throw new Error('COOKIES_JSON phải là danh sách cookie hoặc storageState của Playwright.');
  const cookies = list.filter(cookie => cookie && typeof cookie.domain === 'string' && /(^|\.)tiktok\.com$/.test(cookie.domain.replace(/^\./, ''))).map(cookie => {
    if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string') throw new Error('Cookie không hợp lệ.');
    const domain = cookie.hostOnly === false && !cookie.domain.startsWith('.') ? `.${cookie.domain}` : cookie.domain;
    const result = { name: cookie.name, value: cookie.value, domain, path: cookie.path || '/', httpOnly: !!cookie.httpOnly, secure: cookie.secure !== false };
    const expiry = cookie.expires ?? cookie.expirationDate;
    if (!cookie.session && expiry !== undefined && Number(expiry) > 0) result.expires = Number(expiry);
    const sameSite = { strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None', unspecified: 'None' }[String(cookie.sameSite || '').toLowerCase()];
    if (sameSite) result.sameSite = sameSite;
    return result;
  }).filter(cookie => cookie.expires === undefined || cookie.expires > now);
  if (!cookies.some(cookie => ['sessionid', 'sessionid_ss'].includes(cookie.name) && cookie.value)) throw new Error('Cookie đăng nhập đã hết hạn hoặc không có sessionid.');
  return cookies;
}

function loadCookies(env = process.env) {
  const raw = env.COOKIES_JSON || fs.readFileSync('cookies.json', 'utf8');
  return normalizeCookies(parseJson(raw, 'COOKIES_JSON'));
}

function requireSessionForUrl(cookies, targetUrl) {
  const url = new URL(targetUrl);
  const usable = cookies.some(cookie => {
    if (!['sessionid', 'sessionid_ss'].includes(cookie.name) || !cookie.value.trim()) return false;
    const domain = cookie.domain.replace(/^\./, '').toLowerCase();
    const hostMatches = url.hostname === domain || (cookie.domain.startsWith('.') && url.hostname.endsWith(`.${domain}`));
    const cookiePath = cookie.path || '/';
    const pathMatches = url.pathname === cookiePath || (url.pathname.startsWith(cookiePath) && (cookiePath.endsWith('/') || url.pathname[cookiePath.length] === '/'));
    return hostMatches && pathMatches && (!cookie.secure || url.protocol === 'https:');
  });
  if (!usable) throw new Error('COOKIES_JSON: cookie phiên không áp dụng cho trang tin nhắn. Hãy xuất lại JSON tại TikTok Web đã đăng nhập.');
}

function localDay(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sendWindow(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour').value);
  const slot = hour < 12 ? 'morning' : hour < 18 ? 'noon' : 'evening';
  return { day: localDay(timeZone, date), slot, label: { morning: 'sáng', noon: 'trưa', evening: 'tối' }[slot] };
}

function chooseMessage(config, recipient, lastMessageIndex, key) {
  const pool = recipient.messages || (recipient.message !== undefined ? [recipient.message] : config.messages);
  const index = lastMessageIndex === undefined ? parseInt(key.slice(0, 8), 16) % pool.length : (lastMessageIndex + 1) % pool.length;
  return { index, message: pool[index] };
}

function recipientKey(account, recipient) {
  return crypto.createHash('sha256').update(`${username(account)}\0${username(recipient)}`).digest('hex');
}

module.exports = { username, loadConfig, normalizeCookies, loadCookies, requireSessionForUrl, localDay, sendWindow, chooseMessage, recipientKey };
