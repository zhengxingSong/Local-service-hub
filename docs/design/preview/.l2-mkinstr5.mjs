import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('.l2-verify-instrumented.mjs', 'utf8');
/* 在每个视图切换前记录浮层状态，定位是哪个动作后 m-asset 变 on */
const a = "  if (clickText('服务编辑'))";
const b = "  out.push('DIAG-V chain after run: ' + all('.mw').map(function(m){return m.id+(m.classList.contains('on')?'+':'-');}).join(','));\n  if (clickText('服务编辑'))";
if (!s.includes(a)) { console.error('anchor missing'); process.exit(1); }
s = s.replace(a, b);
const a2 = "  if (clickText('运行')) mark('视图·运行', has('显存'));";
const b2 = "  out.push('DIAG-V before 运行: ' + all('.mw').map(function(m){return m.id+(m.classList.contains('on')?'+':'-');}).join(','));\n  if (clickText('运行')) { mark('视图·运行', has('显存')); out.push('DIAG-V after 运行: ' + all('.mw').map(function(m){return m.id+(m.classList.contains('on')?'+':'-');}).join(',')); }";
if (!s.includes(a2)) { console.error('anchor2 missing'); process.exit(1); }
s = s.replace(a2, b2);
writeFileSync('.l2-verify-instrumented.mjs', s, 'utf8');
console.log('ok');
