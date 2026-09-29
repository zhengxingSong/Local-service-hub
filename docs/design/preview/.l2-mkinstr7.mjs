import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('.l2-verify-instrumented.mjs', 'utf8');
const a = "function openModal(id){";
if (!s.includes(a)) { console.error('anchor missing'); process.exit(1); }
s = s.replace(a, "function openModal(id){ (window.__om=window.__om||[]).push(id);");
const c = "  out.push('DIAG-V chain after run: ";
if (!s.includes(c)) { console.error('anchor2 missing'); process.exit(1); }
s = s.replace(c, "  out.push('DIAG-OPENMODAL: ' + (window.__om||[]).join(','));\n" + c);
writeFileSync('.l2-verify-instrumented.mjs', s, 'utf8');
console.log('ok');
