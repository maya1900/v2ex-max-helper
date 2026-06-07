'use strict';
// ========== 余额监控 ==========
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');
const notify = require('./notify');

const BALANCE_LOG = path.join(__dirname, 'data', 'balance_log.json');

const HOST = 'www.v2ex.com';

const HEADERS = {
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':         'https://www.v2ex.com/',
};

function fetchBalance(cookie) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: HOST,
      path:     '/balance',
      method:   'GET',
      headers:  Object.assign({}, HEADERS, { Cookie: cookie }),
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('balance timeout')));
    req.end();
  });
}

// 解析铜币数量（整数）
function parseCopperCoins(html) {
  if (!html) return null;
  const block = (html.match(/balance_area bigger[\s\S]*?<\/div>/) || [])[0];
  if (!block) return null;
  const re = /(\d+)\s+<img[^>]+alt="B"/;
  const m  = re.exec(block);
  return m ? parseInt(m[1], 10) : null;
}

// 状态
let baseline    = null;   // 基线铜币值
let changeCount = 0;      // 余额变化次数

// 写余额日志（供 /sou 命令使用，不做实时查询）
function saveBalanceLog(copper) {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let log = {};
    if (fs.existsSync(BALANCE_LOG)) {
      log = JSON.parse(fs.readFileSync(BALANCE_LOG, 'utf8'));
    }
    // 滚动：只保留最近 7 天
    const keys = Object.keys(log).sort();
    while (keys.length >= 7) { delete log[keys.shift()]; }
    log[today] = { last: copper, lastTime: new Date().toISOString() };
    fs.writeFileSync(BALANCE_LOG, JSON.stringify(log, null, 2));
  } catch (e) {
    logger.warn(`Balance log write failed: ${e.message}`);
  }
}

async function init(cookie) {
  try {
    const html   = await fetchBalance(cookie);
    const copper = parseCopperCoins(html);
    if (copper === null) {
      logger.warn('Balance: 无法解析铜币（Cookie 可能失效）');
      return false;
    }
    baseline    = copper;
    changeCount = 0;
    logger.info(`Balance baseline: ${copper} 铜币`);
    saveBalanceLog(copper);
    return true;
  } catch (e) {
    logger.error(`Balance init failed: ${e.message}`);
    return false;
  }
}

// 检查余额是否变化，返回当前变化次数
async function check(cookie) {
  try {
    const html   = await fetchBalance(cookie);
    const copper = parseCopperCoins(html);
    if (copper === null) {
      logger.warn('Balance: 无法解析铜币');
      return changeCount;
    }
    saveBalanceLog(copper);
    if (copper !== baseline) {
      changeCount++;
      logger.ok(`Balance changed! ${baseline} → ${copper} 铜币 (变化第 ${changeCount} 次)`);
      await notify.notifyBalanceChanged(baseline, copper, changeCount);
      baseline = copper;
    } else {
      logger.info(`Balance check: ${copper} 铜币（无变化，已触发 ${changeCount} 次）`);
    }
    return changeCount;
  } catch (e) {
    logger.error(`Balance check failed: ${e.message}`);
    return changeCount;
  }
}

function getChangeCount() { return changeCount; }

module.exports = { init, check, getChangeCount };
