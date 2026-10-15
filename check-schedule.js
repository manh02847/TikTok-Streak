const fs = require('node:fs');
const { loadConfig } = require('./lib/config');
const { GitHubState, Journal } = require('./lib/state');
const { automaticWindow, checkSchedule } = require('./lib/schedule');

async function main() {
  const config = loadConfig();
  const now = new Date();
  const journal = config.enabled && automaticWindow(config.timeZone, now)
    ? new Journal(new GitHubState(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN, process.env.GITHUB_SHA))
    : null;
  const result = await checkSchedule(config, journal, now);
  console.log(result.reason);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `proceed=${result.proceed}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Kiểm tra lịch tự động\n\n${result.reason}\n`);
}

main().catch(error => {
  console.error(`Kiểm tra lịch dừng: ${error.message}`);
  process.exitCode = 1;
});
