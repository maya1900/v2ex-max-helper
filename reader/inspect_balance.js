'use strict';
// 调试工具：抓取 /balance 页面，打印活跃度/奖励相关的 HTML 片段
// 用于排查铜币解析正则是否匹配，正常运行不需要它。
const https = require('https');
const fs    = require('fs');
const os    = require('os');
const path  = require('path');

const COOKIE_FILE = process.env.COOKIE_FILE || path.join(os.homedir(), '.v2ex_cookie');
const cookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim();

const req = https.request({
  hostname: 'www.v2ex.com', path: '/balance', method: 'GET',
  headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }
}, res => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => {
    // 找交易记录相关行
    const lines = b.split('\n');
    const relevant = lines.filter(l =>
      l.includes('活') || l.includes('奖') || l.includes('签到') ||
      l.includes('award') || l.includes('tr') || l.includes('copper')
    );
    console.log('=== 相关行 ===');
    console.log(relevant.slice(0, 40).join('\n'));
    console.log('\n=== 交易区域 ===');
    const start = b.indexOf('balance_area');
    console.log(b.substring(start, start + 3000));
  });
});
req.end();
