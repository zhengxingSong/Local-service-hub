import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('.l2-verify-instrumented.mjs', 'utf8');
/* 在模态循环内部逐步打印 */
const a = "    var before = visibleModals();";
const b = "    out.push('DIAG-STEP ' + name + ' btnTag=' + btn.tagName + ' btnCls=' + btn.className + ' chain=' + all('.mw').map(function(m){return m.id+(m.classList.contains('on')?'+':'-');}).join(',') + ' before=' + before);\n    var before = visibleModals();";
if (!s.includes(a)) { console.error('anchor missing'); process.exit(1); }
s = s.replace(a, b);
const c = "    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));";
const d = "    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));\n    out.push('DIAG-STEP ' + name + ' after-esc chain=' + all('.mw').map(function(m){return m.id+(m.classList.contains('on')?'+':'-');}).join(','));";
s = s.replace(c, d);
writeFileSync('.l2-verify-instrumented.mjs', s, 'utf8');
console.log('ok');
