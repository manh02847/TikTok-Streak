const { recipientKey, sendWindow } = require('./config');

function automaticWindow(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const minute = Number(values.hour) * 60 + Number(values.minute);
  const allowed = (minute >= 8 * 60 + 17 && minute < 12 * 60)
    || (minute >= 12 * 60 + 17 && minute < 18 * 60)
    || (minute >= 20 * 60 + 17 && minute < 23 * 60);
  return allowed ? sendWindow(timeZone, date) : null;
}

function windowStillOpen(timeZone, expected, date = new Date()) {
  const current = automaticWindow(timeZone, date);
  return !!current && current.day === expected.day && current.slot === expected.slot;
}

async function checkSchedule(config, journal, date = new Date()) {
  if (!config.enabled) return { proceed: false, reason: 'Bot đang tắt.' };
  const window = automaticWindow(config.timeZone, date);
  if (!window) return { proceed: false, reason: 'Ngoài giờ tự động: chỉ gửi 08:17–11:59, 12:17–17:59 và 20:17–22:59 theo giờ Việt Nam; bỏ qua lượt chạy trễ.' };
  if (!config.accountUsername || !config.recipients.length) throw new Error('Thiếu ACCOUNT_USERNAME hoặc RECIPIENTS_JSON.');
  let pending = 0;
  for (const recipient of config.recipients) {
    if (!await journal.blocked(recipientKey(config.accountUsername, recipient.username), window.day, window.slot)) pending++;
  }
  return {
    proceed: pending > 0,
    window,
    reason: `Khung ${window.label} ${window.day}: ${pending ? `còn ${pending} người chưa có lượt` : 'mọi người đã có lượt; bỏ qua trước khi mở TikTok'}.`,
  };
}

module.exports = { automaticWindow, windowStillOpen, checkSchedule };
