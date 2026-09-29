import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('.l2-verify-instrumented.mjs', 'utf8');
/* 给 openModal 打点：谁打开的、来自哪一行 */
const a = "function openModal(id){";
const b = "function openModal(id){ window.__om=(window.__om||[]); window.__om.push(id+' @'+(new Error().stack||'').split('\\\\n')[1]);";
if (!s.includes(a)) { console.error('anchor missing'); process.exit(1); }
s = s.replace(a, b);
const c = "  out.push('DIAG-V chain after run: ";
const d = "  out.push('DIAG-OPENMODAL: ' + (window.__om||[]).join(' || '));\n  out.push('DIAG-V chain after run: ";
s = s.replace(c, d);
writeFileSync('.l2-verify-instrumented.mjs', s, 'utf8');
console.log('ok');
