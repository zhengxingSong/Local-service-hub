import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:\\LLM Model\\llama.cpp\\desktop\\docs\\design\\preview\\ui-l2-carbon.html';
let t = readFileSync(f, 'utf8');
const reps = [
  ['<div class="fam" data-fam="occ" data-open="1">', '<div class="fam" id="fam-occ" data-id="fam-occ" data-open="1">'],
  ['<div class="fam" data-fam="res" data-open="1">', '<div class="fam" id="fam-res" data-id="fam-res" data-open="1">'],
  ['<div class="fam fam-pass" data-fam="dep" data-open="0">', '<div class="fam fam-pass" id="fam-dep" data-id="fam-dep" data-open="0">'],
  ['<div class="fam fam-pass" data-fam="env" data-open="0">', '<div class="fam fam-pass" id="fam-env" data-id="fam-env" data-open="0">'],
  ["+ ' data-cond=\"恒显示\" data-rel=\"' + (g.id==='ov' ? 'rig-ov' : 'rig-chat') + '\">'",
   "+ ' data-cond=\"恒显示\" data-target=\"' + (g.id==='ov' ? 'rig-ov' : 'rig-chat') + '\" data-rel=\"' + (g.id==='ov' ? 'rig-ov' : 'rig-chat') + '\">'"]
];
for (const [a,b] of reps) {
  if (!t.includes(a)) { console.error('MISS: ' + a.slice(0, 60)); process.exit(1); }
  t = t.split(a).join(b);
}
writeFileSync(f, t, 'utf8');
console.log('patched ok');
