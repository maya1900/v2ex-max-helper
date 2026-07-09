'use strict';
// ========== Telegram 推送通知 ==========
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');

// 从环境变量或 ~/.v2ex_env 文件读取配置
function loadConfig() {
  // 先尝试读取 env 文件
  const envFile = path.join(require('os').homedir(), '.v2ex_env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim();
      }
    }
  }
  const dataDir = process.env.V2EX_DATA_DIR || path.join(__dirname, 'data');
  const authChatFile = path.join(dataDir, '.telegram_chat_id');
  let chatId = process.env.TG_CHAT_ID || '';
  if (!chatId && fs.existsSync(authChatFile)) {
    try {
      chatId = fs.readFileSync(authChatFile, 'utf8').trim();
    } catch (_) {}
  }
  return {
    token: process.env.TG_TOKEN || '',
    chatId,
  };
}

const cfg = loadConfig();

function isConfigured() {
  // 未配置 Token / Chat ID 时静默跳过推送，不影响主流程
  return Boolean(cfg.token && cfg.chatId);
}

function sendMessage(text) {
  if (!isConfigured()) return Promise.resolve();
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${cfg.token}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', resolve); // 推送失败不影响主流程
    req.setTimeout(10000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

// ========== 预定义通知模板 ==========

// 阅读完成
async function notifyReaderDone(stats) {
  const emoji = stats.changed >= 2 ? '🎉' : '✅';
  await sendMessage(
    `${emoji} <b>V2EX 阅读完成</b>\n` +
    `📖 阅读: ${stats.read} 篇\n` +
    `💰 余额变化: ${stats.changed} 次\n` +
    `⏱ 耗时: ${stats.elapsed}\n` +
    `🛑 原因: ${stats.reason || '达到上限'}`
  );
}

// 连续错误停止
async function notifyReaderError(stats) {
  const reason = stats.reason || '连续 3 次失败';
  const hint = reason.includes('Cookie')
    ? 'Cookie 已确认失效，请更新'
    : '已跳过异常帖子，请查看日志确认网络/CF/重定向状态';
  await sendMessage(
    `⚠️ <b>V2EX 阅读中止</b>\n` +
    `❌ ${reason}\n` +
    `📖 已读: ${stats.read} 篇\n` +
    `💡 ${hint}`
  );
}

// Cookie / 登录失效
async function notifySessionExpired() {
  await sendMessage(
    `🔴 <b>V2EX Session 失效</b>\n` +
    `Cookie 已过期，请重新登录并更新 Cookie\n` +
    `更新方式：将新 Cookie 写入服务器的 <code>~/.v2ex_cookie</code>`
  );
}

// 余额变化（活跃度奖励）
async function notifyBalanceChanged(fromText, toText, count, deltaText = '') {
  const delta = deltaText ? ` (${deltaText})` : '';
  await sendMessage(
    `💰 <b>V2EX 活跃度奖励</b>\n` +
    `余额: ${fromText} → ${toText}${delta}\n` +
    `今日第 ${count} 次奖励`
  );
}

// 签到结果（供 checkin 复用）
async function notifyCheckin(result) {
  const ok = result.success;
  await sendMessage(
    `${ok ? '✅' : '❌'} <b>V2EX 签到${ok ? '成功' : '失败'}</b>\n` +
    `${result.message || ''}`
  );
}

module.exports = {
  isConfigured,
  sendMessage,
  notifyReaderDone,
  notifyReaderError,
  notifySessionExpired,
  notifyBalanceChanged,
  notifyCheckin,
};
