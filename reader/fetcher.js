'use strict';
// ========== 帖子 URL 多源抓取 ==========
const https  = require('https');
const logger = require('./logger');
const fingerprint = require('./fingerprint');

const HOST = 'www.v2ex.com';
const PROFILE = (process.env.V2EX_PROFILE || 'default').trim() || 'default';
const FP = fingerprint.generate(PROFILE);

// 多源配置
const SOURCES = [
  { path: '/recent',           name: '最新' },
  { path: '/?tab=hot',         name: '热帖' },
  { path: '/?tab=all',         name: '全部' },
  { path: '/?tab=tech',        name: '技术' },
  { path: '/go/programming',   name: '编程' },
  { path: '/go/python',        name: 'Python' },
  { path: '/go/linux',         name: 'Linux' },
  { path: '/go/cn',            name: '中文' },
];

// 多页抓取（/recent 支持翻页）
const RECENT_PAGES = [
  '/recent?p=1',
  '/recent?p=2',
  '/recent?p=3',
];

const COMMON_HEADERS = {
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': FP.acceptLanguage,
  'User-Agent':      FP.userAgent,
  'Referer':         'https://www.v2ex.com/',
};

const FETCH_SLEEP_MIN = intEnv('FETCH_SLEEP_MIN', 1500);
const FETCH_SLEEP_MAX = Math.max(FETCH_SLEEP_MIN, intEnv('FETCH_SLEEP_MAX', 5000));

function fetchPage(reqPath, cookie) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: HOST,
      path: reqPath,
      method: 'GET',
      headers: Object.assign({}, COMMON_HEADERS, { Cookie: cookie }),
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// 从 HTML 中提取帖子 URL（/t/数字）
function extractPostUrls(html) {
  const urls = [];
  const seen = new Set();
  // 匹配 href="/t/数字" 格式
  const re = /href="\/t\/(\d+)[^"]*"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = `https://${HOST}/t/${m[1]}`;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

// 冷却控制
let lastFetchTime = 0;
const FETCH_COOLDOWN = 5 * 60 * 1000; // 5 分钟冷却

// 从所有来源抓取帖子 URL
async function fetchAll(cookie) {
  const now = Date.now();
  if (now - lastFetchTime < FETCH_COOLDOWN && lastFetchTime > 0) {
    logger.info(`Fetcher 冷却中，跳过（${Math.ceil((FETCH_COOLDOWN - (now - lastFetchTime)) / 1000)}s 后可用）`);
    return [];
  }
  lastFetchTime = now;

  const allUrls = [];

  // 多页 /recent
  for (const p of shuffle(RECENT_PAGES)) {
    try {
      const html = await fetchPage(p, cookie);
      const urls = extractPostUrls(html);
      logger.info(`Fetcher ${p}: ${urls.length} posts`);
      allUrls.push(...urls);
      await sleep(randomFetchSleepMs());
    } catch (e) {
      logger.warn(`Fetcher ${p} failed: ${e.message}`);
    }
  }

  // 其他来源
  for (const src of shuffle(SOURCES)) {
    try {
      const html = await fetchPage(src.path, cookie);
      const urls = extractPostUrls(html);
      logger.info(`Fetcher ${src.name} (${src.path}): ${urls.length} posts`);
      allUrls.push(...urls);
      await sleep(randomFetchSleepMs());
    } catch (e) {
      logger.warn(`Fetcher ${src.name} failed: ${e.message}`);
    }
  }

  // 去重
  const unique = [...new Set(allUrls)];
  logger.info(`Fetcher total unique: ${unique.length}`);
  return unique;
}

// 强制抓取（忽略冷却，供初始化使用）
async function fetchAllForce(cookie) {
  lastFetchTime = 0;
  return fetchAll(cookie);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function intEnv(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomFetchSleepMs() {
  return randInt(FETCH_SLEEP_MIN, FETCH_SLEEP_MAX);
}

function shuffle(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { fetchAll, fetchAllForce };
