import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('verify-preview.mjs', 'utf8');
/* 在每个模态按钮遍历前打印：哪些 .mw 带 on、可见浮层数 */
const needle = "  ['\u9884\u68c0', '\u5371\u9669\u786e\u8ba4', '\u6d4b\u8bd5']";
const diag = "  out.push('DIAG-MODALS before loop: ' + all('.mw').map(function(m){return m.id+'='+(m.classList.contains('on')?'on':'off')+'/vis'+vis(m);}).join(' '));\n";
const anchor = "  /* \u4e94\u4e2a\u6a21\u6001";
let idx = s.indexOf(anchor);
if (idx < 0) { console.error('anchor missing'); process.exit(1); }
s = s.slice(0, idx) + diag + s.slice(idx);
/* 也要在视图切换后打印 */
const a2 = "  /* \u4e94\u4e2a\u6a21\u6001\uff1a";
writeFileSync('.l2-verify-instrumented.mjs', s, 'utf8');
console.log('ok');
