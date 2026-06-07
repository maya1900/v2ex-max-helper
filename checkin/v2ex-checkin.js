#!/usr/bin/env node
/**
 * V2EX 每日签到 - Node.js 独立版（含保活机制）
 * Version: v1.3.0
 *
 * 用法：
 *   保存 Cookie：
 *     V2EX_COOKIE="..." node v2ex-checkin.js --save-cookie
 *
 *   每日签到（crontab 01:10 UTC = 北京 09:10）：
 *     10 1 * * * /usr/bin/node /path/to/v2ex-checkin.js >> /var/log/v2ex.log 2>&1
 *
 *   保活心跳，每6小时访问一次（防 Session 过期）：
 *     0 */6 * * *  node /path/to/v2ex-checkin.js --ping
 *
 * 推送告警（Cookie 失效时通知）：
 *   Bark:     BARK_URL="https://api.day.app/你的KEY" node v2ex-checkin.js
 *   Telegram: TG_BOT_TOKEN="xxx" TG_CHAT_ID="xxx" node v2ex-checkin.js
 *
 * Cookie 存储位置：~/.v2ex_cookie（或 COOKIE_FILE 环境变量）
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const url   = require('url');

// ========== 配置 ==========
const SCRIPT_VERSION = 'v1.3.0';
const HOST           = 'www.v2ex.com';
const COOKIE_FILE    = process.env.COOKIE_FILE || path.join(os.homedir(), '.v2ex_cookie');
const MAX_RETRY      = 3;

// 推送配置（从环境变量读取，不硬编码）
const BARK_URL       = process.env.BARK_URL    || '';   // e.g. https://api.day.app/YOUR_KEY
const TG_BOT_TOKEN   = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID     = process.env.TG_CHAT_ID   || '';

const COMMON_HEADERS = {
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en,zh-CN;q=0.9,zh;q=0.8',
  'cache-control':   'max-age=0',
  'pragma':          'no-cache',
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':         'https://www.v2ex.com/'
};

// ========== Cookie 存储 ==========
function readCookie() {
  try {
    if (fs.existsSync(COOKIE_FILE)) return fs.readFileSync(COOKIE_FILE, 'utf8').trim();
  } catch (e) {}
  return '';
}

function writeCookie(cookie) {
  try {
    fs.writeFileSync(COOKIE_FILE, cookie.trim(), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('写入 Cookie 失败:', e.message);
    return false;
  }
}

// ========== HTTP 请求 ==========
function fetchUrl(reqUrl, cookie) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, COMMON_HEADERS, { Cookie: cookie });
    const parsed  = new url.URL(reqUrl);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(reqUrl, { headers }, (res) => {
      // 跟随重定向（最多3次）
      if ([301, 302, 303].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${HOST}${res.headers.location}`;
        res.resume();
        return fetchUrl(loc, cookie).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
  });
}

// ========== 推送通知 ==========
function sendBark(title, msg) {
  if (!BARK_URL) return Promise.resolve();
  const target = `${BARK_URL.replace(/\/$/, '')}/${encodeURIComponent(title)}/${encodeURIComponent(msg)}`;
  return fetchUrl(target, '').catch(() => {});
}

function sendTelegram(title, msg) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return Promise.resolve();
  const text = `*${title}*\n${msg}`;
  const target = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage?chat_id=${TG_CHAT_ID}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;
  return fetchUrl(target, '').catch(() => {});
}

function notify(title, msg) {
  return Promise.all([sendBark(title, msg), sendTelegram(title, msg)]);
}

// ========== 解析函数 ==========
function formatBalance(html) {
  if (!html) return '';
  const block = (html.match(/balance_area bigger[\s\S]*?<\/div>/) || [])[0];
  if (!block) return '';
  const parts = [];
  const re = /(\d+)\s+<img[^>]+alt="([A-Z])"/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    if (m[2] === 'G') parts.push(m[1] + ' 金币');
    if (m[2] === 'S') parts.push(m[1] + ' 银币');
    if (m[2] === 'B') parts.push(m[1] + ' 铜币');
  }
  return parts.join(', ');
}

function parseLoginStatus(html) {
  if (!html) return { logged_in: false };
  if (html.includes('你要查看的页面需要先登录') || html.includes('需要先登录')) {
    return { logged_in: false };
  }
  return { logged_in: true };
}

async function getOnce(cookie) {
  const html = await fetchUrl('https://www.v2ex.com/mission/daily', cookie);
  const status = parseLoginStatus(html);
  if (!status.logged_in) return { once: '', logged_in: false, already: false, days: '?' };
  const days = (html.match(/已连续登录\s*(\d+)\s*天/) || [])[1] || '?';
  if (html.includes('每日登录奖励已领取')) return { once: '', logged_in: true, already: true, days };
  const once = (html.match(/once=(\d+)/) || [])[1] || '';
  return { once, logged_in: true, already: false, days };
}

async function queryBalance(cookie) {
  return formatBalance(await fetchUrl('https://www.v2ex.com/balance', cookie));
}

// ========== Logger ==========
function pad(n) { return String(n).padStart(2, '0'); }
function tsNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} UTC`;
}
function log(msg) { console.log(msg); }
function logField(label, value) {
  const key = (label + '              ').substring(0, 14);
  log(`${key}: ${value}`);
}
function sep() { log('------------------------------------'); }

// ========== 保活心跳 ==========
async function doPing() {
  log(`🏓 V2EX Ping Start`);
  log(`Time     : ${tsNow()}`);
  sep();
  const cookie = readCookie();
  if (!cookie) {
    log('⚠️  无 Cookie，跳过保活');
    return;
  }
  try {
    const html = await fetchUrl('https://www.v2ex.com/', cookie);
    const status = parseLoginStatus(html);
    if (!status.logged_in) {
      log('❌ Cookie 已失效（保活检测）');
      await notify('V2EX ⚠️ Cookie 失效', '请重新登录 V2EX 并更新 Cookie，签到将中断！');
      log('📢 告警已发送（如已配置推送）');
    } else {
      log('✅ Session 正常，保活成功');
    }
  } catch (e) {
    log(`⚠️  保活请求失败: ${e.message}`);
  }
  log('🏓 Ping End');
}

// ========== 主签到逻辑 ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function doCheckin(attempt = 0) {
  const cookie = readCookie();
  if (!cookie) {
    log('⚠️  无 Cookie，请先运行：V2EX_COOKIE="..." node v2ex-checkin.js --save-cookie');
    process.exit(1);
  }

  if (attempt === 0) {
    log('🚀 V2EX Script Start');
    log(`Time     : ${tsNow()}`);
    log(`Version  : ${SCRIPT_VERSION}`);
    sep();
  }

  try {
    logField('Action', `签到尝试 ${attempt + 1}/${MAX_RETRY}`);
    const info = await getOnce(cookie);

    if (!info.logged_in) {
      logField('Status', '❌ Cookie 已失效');
      log('📢 发送失效告警...');
      await notify('V2EX ❌ Cookie 失效', '签到失败，请重新登录 V2EX 更新 Cookie！连续天数将中断。');
      sep();
      log('📊 Summary\nFailed     : 1\n🎯 Result  : Cookie 已失效');
      process.exit(1);
    }

    if (info.already) {
      const balance = await queryBalance(cookie);
      log(`👤 Account | ${HOST}`);
      logField('Status',    '🔁 今日已签到');
      logField('Days left', `连续 ${info.days} 天`);
      if (balance) logField('Balance', balance);
      sep();
      log(`📊 Summary\nDuplicate  : 1\n🎯 Result  : 今日已签到`);
      return;
    }

    if (!info.once) {
      if (attempt + 1 < MAX_RETRY) {
        log('once 码未找到，3 秒后重试...');
        await sleep(3000);
        return doCheckin(attempt + 1);
      }
      logField('Status', '❌ 未找到 once 码');
      await notify('V2EX ❌ 签到失败', '未找到 once 码，请检查网络或 Cookie');
      process.exit(1);
    }

    await fetchUrl(`https://www.v2ex.com/mission/daily/redeem?once=${info.once}`, cookie);
    const balance = await queryBalance(cookie);

    log(`👤 Account | ${HOST}`);
    logField('Status',    '✅ 签到成功');
    logField('Days left', `连续 ${info.days} 天`);
    if (balance) logField('Balance', balance);
    sep();
    log(`📊 Summary\nSuccess    : 1\n🎯 Result  : 签到成功`);

  } catch (e) {
    if (attempt + 1 < MAX_RETRY) {
      log(`网络错误: ${e.message}，3 秒后重试...`);
      await sleep(3000);
      return doCheckin(attempt + 1);
    }
    logField('Status', `❌ 网络错误: ${e.message}`);
    await notify('V2EX ❌ 网络错误', e.message);
    process.exit(1);
  }
}

// ========== 入口 ==========
const args = process.argv.slice(2);

if (args.includes('--save-cookie')) {
  const cookie = process.env.V2EX_COOKIE || '';
  if (!cookie) {
    console.error('请设置环境变量 V2EX_COOKIE="your_cookie_here"');
    process.exit(1);
  }
  if (writeCookie(cookie)) console.log(`✅ Cookie 已保存到 ${COOKIE_FILE}`);
} else if (args.includes('--ping')) {
  doPing().catch(e => { console.error(e.message); process.exit(1); });
} else {
  doCheckin().catch(e => { console.error('未捕获错误:', e.message); process.exit(1); });
}
