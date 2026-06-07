'use strict';
// ========== 统一日志 ==========
function pad(n) { return String(n).padStart(2, '0'); }
function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} UTC`;
}
const logger = {
  info:  (m) => console.log(`[${ts()}] [INFO ] ${m}`),
  ok:    (m) => console.log(`[${ts()}] [OK   ] ${m}`),
  warn:  (m) => console.warn(`[${ts()}] [WARN ] ${m}`),
  error: (m) => console.error(`[${ts()}] [ERROR] ${m}`),
  sep:   ()  => console.log('─'.repeat(60)),
};
module.exports = logger;
