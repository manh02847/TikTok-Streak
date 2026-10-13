const fs = require('node:fs');
const { loadConfig, loadCookies, requireSessionForUrl, recipientKey, sendWindow, chooseMessage } = require('./lib/config');
const { LocalState, GitHubState, Journal } = require('./lib/state');
const { TikTok } = require('./lib/tiktok');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const checkConfig = process.argv.includes('--check-config');
  const config = loadConfig();
  if (!config.enabled && !dryRun && !checkConfig) {
    console.log('Bot đang tắt. Cấu hình rồi bật BOT_ENABLED trong GitHub Actions Variables.');
    return;
  }
  if (!config.accountUsername || !config.recipients.length) throw new Error('Thiếu ACCOUNT_USERNAME hoặc RECIPIENTS_JSON.');
  const cookies = loadCookies();
  requireSessionForUrl(cookies, config.targetUrl);
  if (checkConfig) {
    const summary = [
      'ACCOUNT_USERNAME: định dạng hợp lệ.',
      `RECIPIENTS_JSON: hợp lệ, ${config.recipients.length} người nhận sau khi loại trùng.`,
      `Nội dung chung: ${config.messages.length} câu luân phiên; ${config.recipients.filter(item => item.message !== undefined).length} người dùng câu cố định; ${config.recipients.filter(item => item.messages !== undefined).length} người dùng danh sách riêng.`,
      `COOKIES_JSON: JSON hợp lệ, ${cookies.length} cookie TikTok chưa hết hạn theo dữ liệu xuất; có cookie phiên áp dụng cho trang tin nhắn.`,
      'Chưa kiểm tra TikTok có chấp nhận phiên đăng nhập. Chạy dry-run để kiểm tra thực tế.',
    ].join('\n');
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Kiểm tra cấu hình\n\n${summary.replaceAll('\n', '\n\n')}\n`);
    return;
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: config.headless });
  const report = { verified: 0, sent: 0, skipped: 0, failed: 0, uncertain: 0 };
  let ready = false;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
    await context.addCookies(cookies);
    const page = await context.newPage();
    const tiktok = new TikTok(page, config);
    await tiktok.open();
    await tiktok.verifyAccount(config.accountUsername);
    ready = true;
    const store = process.env.GITHUB_ACTIONS === 'true'
      ? new GitHubState(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN, process.env.GITHUB_SHA)
      : new LocalState('state.json');
    const journal = new Journal(store);
    for (const recipient of config.recipients) {
      const key = recipientKey(config.accountUsername, recipient.username);
      const { day, slot, label: slotLabel } = sendWindow(config.timeZone);
      const label = key.slice(0, 8);
      let claimed = false;
      let attempted = false;
      try {
        if (!dryRun && await journal.blocked(key, day, slot)) {
          report.skipped++;
          const previous = (await journal.load()).entries[key];
          console.log(`${label}: khung ${slotLabel} ${day} ${previous.slots[slot] === 'sent' ? 'đã thấy tin còn trong lịch sử' : 'đã thử gửi nhưng chưa xác nhận được'}; bỏ qua.`);
          continue;
        }
        await tiktok.selectRecipient(recipient.username, recipient.chatName);
        await tiktok.prepare(recipient.username);
        report.verified++;
        if (dryRun) {
          console.log(`${label}: đúng người nhận, ô soạn trống; chưa nhập hoặc gửi tin.`);
          continue;
        }
        const previous = (await journal.load()).entries[key];
        const selected = chooseMessage(config, recipient, previous?.lastMessageIndex, key);
        if (!await journal.claim(key, day, slot, selected.index)) { report.skipped++; continue; }
        claimed = true;
        const result = await tiktok.send(recipient.username, selected.message, () => { attempted = true; });
        await journal.finish(key, day, result ? 'sent' : 'uncertain', slot);
        claimed = false;
        report[result ? 'sent' : 'uncertain']++;
        console.log(`${label}: khung ${slotLabel} ${day}; ${result ? 'đã thấy tin mới còn trong lịch sử sau khi mở lại cuộc chat' : 'chưa xác nhận được trên lịch sử sau khi gửi, không tự gửi lại trong khung này'}.`);
      } catch (error) {
        if (claimed) await journal.finish(key, day, attempted ? 'uncertain' : 'failed', slot);
        report[attempted ? 'uncertain' : 'failed']++;
        console.log(`${label}: ${error.code || 'CHECK_FAILED'}; không gửi tiếp cho người này.`);
        if (error.code === 'AUTH_REQUIRED' || error.code === 'BOT_BLOCKED') throw error;
      }
      if (!dryRun) await new Promise(resolve => setTimeout(resolve, config.betweenRecipientsMs));
    }
  } finally {
    await browser.close();
    const summary = ready
      ? `Đúng người: ${report.verified}; tin mới trên giao diện: ${report.sent}; bỏ qua: ${report.skipped}; lỗi: ${report.failed}; chưa rõ kết quả: ${report.uncertain}.`
      : 'Dừng trước khi xác minh tài khoản; chưa kiểm tra người nhận hoặc gửi tin.';
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Auto Chuỗi TikTok\n\n${dryRun ? 'Chế độ kiểm tra, không gửi tin.' : 'Mỗi người tối đa một lần thử gửi trong mỗi khung sáng/trưa/tối, tối đa ba khung mỗi ngày.'}\n\n${summary}\n`);
  }
  if (report.failed || report.uncertain) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  console.error(`Bot dừng: ${error.code || error.message}`);
  if (error.code === 'AUTH_REQUIRED') console.error('TikTok chuyển tới trang đăng nhập. Xuất lại toàn bộ cookie JSON từ TikTok Web đã đăng nhập, cập nhật COOKIES_JSON rồi chạy dry-run. Cấu hình đúng chưa bảo đảm TikTok chấp nhận phiên trên GitHub Actions.');
  process.exitCode = 1;
});

module.exports = { main };
