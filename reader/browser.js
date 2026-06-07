'use strict';
// ========== Playwright 浏览器控制 ==========
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const logger = require('./logger');

const COOKIE_FILE    = process.env.COOKIE_FILE || path.join(os.homedir(), '.v2ex_cookie');
const USER_DATA_DIR  = path.join(__dirname, 'data', 'chrome-profile');
const HOST           = 'www.v2ex.com';

// Cookie 字符串 → Playwright cookies 数组
function parseCookieString(str) {
  return str.split(';').map(s => s.trim()).filter(Boolean).map(part => {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) return null;
    const name  = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    return {
      name,
      value,
      domain: `.${HOST}`,
      path:   '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    };
  }).filter(Boolean);
}

// Playwright cookies 数组 → Cookie 字符串（写回文件）
function serializeCookies(cookies) {
  return cookies
    .filter(c => c.domain && c.domain.includes('v2ex'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

let ctx      = null;   // BrowserContext（persistent context）
let page     = null;
let isDryRun = false;

async function launch(dryRun = false) {
  isDryRun = dryRun;

  // 检查 Cookie 文件（dry-run 也需要读取用于 fetcher/balance）
  const cookieStr = fs.existsSync(COOKIE_FILE)
    ? fs.readFileSync(COOKIE_FILE, 'utf8').trim()
    : '';
  if (!cookieStr) {
    throw new Error(`Cookie 文件不存在或为空: ${COOKIE_FILE}`);
  }

  if (dryRun) {
    logger.info('[DRY-RUN] 跳过浏览器启动');
    return;
  }

  const { chromium } = require('playwright');

  // 确保 Chrome profile 目录存在
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  logger.info('浏览器启动中...');

  ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    ignoreHTTPSErrors: false,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1280, height: 800 },
  });

  // 注入 JS 隐藏 webdriver 标志
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // 注入 Cookies
  const cookies = parseCookieString(cookieStr);
  await ctx.addCookies(cookies);
  logger.info(`已注入 ${cookies.length} 条 Cookie`);

  // 使用已有 page 或新建
  const pages = ctx.pages();
  page = pages.length > 0 ? pages[0] : await ctx.newPage();

  logger.ok('浏览器已就绪');
}

// 读取一篇帖子（15秒 ± 随机抖动）
async function readPost(url) {
  if (isDryRun) {
    logger.info(`[DRY-RUN] → ${url}`);
    await sleep(200);
    return true;
  }

  try {
    logger.info(`→ ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 检测 Cloudflare 挑战页面
    const isCF = await detectCloudflareChallenge();
    if (isCF) {
      logger.warn('Cloudflare 挑战中，等待最多 60 秒...');
      const passed = await waitForCloudflare();
      if (!passed) return false;
    }

    // 检测是否登录
    const content = await page.content();
    if (content.includes('你要查看的页面需要先登录') || content.includes('需要先登录')) {
      logger.error('Cookie 已失效，请重新获取');
      return false;
    }

    // 随机停留 12~18 秒（均值 15）
    const delay = 12000 + Math.floor(Math.random() * 6000);
    await sleep(delay);

    // 同步 Cookie（cf_clearance 可能已刷新）
    await syncCookies();

    return true;
  } catch (e) {
    logger.warn(`读帖失败: ${e.message} → ${url}`);
    return false;
  }
}

// 检测是否出现 Cloudflare 挑战
async function detectCloudflareChallenge() {
  try {
    const title = await page.title();
    const url   = page.url();
    return title.includes('Just a moment') ||
           title.includes('Attention Required') ||
           url.includes('challenge');
  } catch (_) { return false; }
}

// 等待 Cloudflare 挑战通过
async function waitForCloudflare(timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await sleep(3000);
    const isCF = await detectCloudflareChallenge();
    if (!isCF) {
      logger.ok('Cloudflare 挑战已通过');
      return true;
    }
  }
  logger.error('Cloudflare 挑战超时（60s）');
  return false;
}

// 将 Playwright context 的最新 Cookie 写回文件
async function syncCookies() {
  if (!ctx) return;
  try {
    const cookies = await ctx.cookies();
    const str     = serializeCookies(cookies);
    if (str) {
      fs.writeFileSync(COOKIE_FILE, str, { mode: 0o600 });
    }
  } catch (e) {
    logger.warn(`Cookie 同步失败: ${e.message}`);
  }
}

// 获取当前 Cookie 字符串（供 balance.js / fetcher.js 使用）
async function getCurrentCookie() {
  if (ctx) {
    try {
      const cookies = await ctx.cookies();
      return serializeCookies(cookies);
    } catch (_) {}
  }
  // fallback: 直接读文件
  return fs.existsSync(COOKIE_FILE)
    ? fs.readFileSync(COOKIE_FILE, 'utf8').trim()
    : '';
}

async function close() {
  try {
    if (ctx) {
      await syncCookies();
      await ctx.close();
    }
    logger.info('浏览器已关闭');
  } catch (e) {
    logger.warn(`关闭浏览器时出错: ${e.message}`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { launch, readPost, getCurrentCookie, syncCookies, close };
