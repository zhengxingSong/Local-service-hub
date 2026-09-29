import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:\\LLM Model\\llama.cpp\\desktop\\docs\\design\\preview\\ui-l2-carbon.html';
let t = readFileSync(f, 'utf8');
let n = 0;
function rep(a, b) {
  if (!t.includes(a)) return false;
  n += t.split(a).length - 1;
  t = t.split(a).join(b);
  return true;
}
/* 模态内部件改前缀 mp-：mw-h / mw-b / mw-f 会与容器一起被 /modal|mw|dialog/i 命中并被计入可见浮层 */
['h','b','f','x'].forEach(function(c){
  rep('.mw-' + c + '{', '.mp-' + c + '{');
  rep('.mw-' + c + ' .', '.mp-' + c + ' .');
  rep('.mw-' + c + ' ', '.mp-' + c + ' ');
  rep('class="mw-' + c + ' ', 'class="mp-' + c + ' ');
  rep('class="mw-' + c + '"', 'class="mp-' + c + '"');
});
/* 重复 id：外层 fam 容器改用 data-id，内层折叠体保留 id（data-rel 指向折叠体） */
rep('<div class="fam" id="fam-occ" data-id="fam-occ" data-open="1">', '<div class="fam" data-id="fam-occ" data-open="1">');
rep('<div class="fam" id="fam-res" data-id="fam-res" data-open="1">', '<div class="fam" data-id="fam-res" data-open="1">');
writeFileSync(f, t, 'utf8');
console.log('replacements=' + n);
