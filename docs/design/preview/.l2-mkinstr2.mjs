import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('.l2-verify-instrumented.mjs', 'utf8');
const lines = s.split('\n');
const anchor = lines.findIndex(l => l.includes('var detectBtn = all('));
if (anchor < 0) { console.error('anchor not found'); process.exit(1); }
lines.splice(anchor, 0,
  "  out.push('DIAG-BEFORE-DETECT views=' + all('.view').map(function(v){return v.id+'='+(v.classList.contains('on')?'ON':'off');}).join(' ') + ' vm=' + visibleModals());");
writeFileSync('.l2-verify-instrumented.mjs', lines.join('\n'), 'utf8');
console.log('inserted at ' + anchor);
