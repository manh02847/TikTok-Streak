const fs = require('node:fs/promises');

function validateState(state) {
  if (!state || state.version !== 1 || !state.entries || typeof state.entries !== 'object' || Array.isArray(state.entries)) throw new Error('Trạng thái chống trùng không hợp lệ; bot dừng thay vì xóa trạng thái.');
  for (const [key, entry] of Object.entries(state.entries)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.day) || !['reserved', 'sent', 'uncertain', 'failed'].includes(entry.status)) throw new Error('Dữ liệu chống trùng hỏng; không tự đặt lại.');
  }
  return state;
}

class LocalState {
  constructor(file) { this.file = file; }
  async load() {
    try { return validateState(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, entries: {} }; throw error; }
  }
  async save(state) {
    validateState(state);
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify(state, null, 2));
    await fs.rename(`${this.file}.tmp`, this.file);
  }
}

class GitHubState {
  constructor(repository, token, baseSha, fetcher = fetch) {
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository || '') || !token || !/^[a-f0-9]{40}$/.test(baseSha || '')) throw new Error('Thiếu quyền ghi trạng thái GitHub.');
    Object.assign(this, { repository, token, baseSha, fetcher, branch: 'bot-state', sha: undefined });
  }
  async request(path, method = 'GET', body) {
    const response = await this.fetcher(`https://api.github.com/repos/${this.repository}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw new Error(`Không ghi/đọc được trạng thái GitHub (HTTP ${response.status}).`);
    return response.json();
  }
  async load() {
    const ref = await this.request(`git/ref/heads/${this.branch}`);
    if (!ref) await this.request('git/refs', 'POST', { ref: `refs/heads/${this.branch}`, sha: this.baseSha });
    const file = await this.request(`contents/state.json?ref=${this.branch}`);
    if (!file) { this.sha = undefined; return { version: 1, entries: {} }; }
    this.sha = file.sha;
    return validateState(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
  }
  async save(state) {
    validateState(state);
    const result = await this.request('contents/state.json', 'PUT', {
      message: 'update streak state', branch: this.branch,
      content: Buffer.from(JSON.stringify(state, null, 2)).toString('base64'),
      ...(this.sha ? { sha: this.sha } : {}),
    });
    if (!result.content?.sha) throw new Error('GitHub chưa xác nhận lưu trạng thái; không gửi tin.');
    this.sha = result.content.sha;
  }
}

class Journal {
  constructor(store) { this.store = store; this.state = null; }
  async load() { if (!this.state) this.state = await this.store.load(); return this.state; }
  async blocked(key, day) {
    const entry = (await this.load()).entries[key];
    return !!entry && entry.day === day && ['reserved', 'sent', 'uncertain'].includes(entry.status);
  }
  async claim(key, day) {
    if (await this.blocked(key, day)) return false;
    const next = structuredClone(await this.load());
    next.entries[key] = { day, status: 'reserved' };
    await this.store.save(next);
    this.state = next;
    return true;
  }
  async finish(key, day, status) {
    if (!['sent', 'uncertain', 'failed'].includes(status)) throw new Error('Kết quả gửi không hợp lệ.');
    const next = structuredClone(await this.load());
    if (next.entries[key]?.day !== day || next.entries[key]?.status !== 'reserved') throw new Error('Không có lượt gửi đã được lưu trước.');
    next.entries[key] = { day, status };
    await this.store.save(next);
    this.state = next;
  }
}

module.exports = { LocalState, GitHubState, Journal, validateState };
