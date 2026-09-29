import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('verify-preview.mjs', 'utf8');
/* 在探针里插入诊断输出：不改判定逻辑，只多打印状态 */
s = s.replace(
  "  var stillOpen = all('[class*=modal],[class*=Modal]')",
  "  out.push('DIAG views=' + all('.view').map(function(v){return v.id+'='+(v.classList.contains('on')?'ON':'off');}).join(' ') + ' vm=' + visibleModals() + ' hasMorph=' + has('\\u2460 \\u5f62\\u6001') + ' bodyLen=' + body().length);\n  var stillOpen = all('[class*=modal],[class*=Modal]')"
);
s = s.replace(
  "  var detectBtn = all('button,[role=button]').filter(function (b) { return b.textContent.trim() === '\\u63a2\\u6d4b' && vis(b); })[0];",
  "  out.push('DIAG-BEFORE-DETECT views=' + all('.view').map(function(v){return v.id+'='+(v.classList.contains('on')?'ON':'off');}).join(' ') + ' vm=' + visibleModals());\n  var detectBtn = all('button,[role=button]').filter(function (b) { return b.textContent.trim() === '\\u63a2\\u6d4b' && vis(b); })[0];"
);
writeFileSync('.l2-verify-instrumented.mjs', s, 'utf8');
console.log('ok');
