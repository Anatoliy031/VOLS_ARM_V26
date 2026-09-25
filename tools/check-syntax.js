/* ============================================================================
   tools/check-syntax.js — проверка синтаксиса всех .js и встроенных скриптов
   в .html. Быстрый первый заслон: секунды вместо минут.
   Запуск: node tools/check-syntax.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let bad = 0, n = 0;

fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).forEach((f) => {
  n++;
  try { new Function(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
  catch (e) { bad++; console.log('  ✗ ' + f + ': ' + e.message); }
});
fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).forEach((f) => {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0;
  while ((m = re.exec(s))) {
    i++; n++;
    try { new Function(m[1]); }
    catch (e) { bad++; console.log('  ✗ ' + f + ', блок ' + i + ': ' + e.message); }
  }
});
console.log('  [синтаксис] проверено ' + n + ', с ошибками ' + bad);
process.exit(bad ? 1 : 0);
