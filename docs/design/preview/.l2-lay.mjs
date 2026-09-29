import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const file = 'D:\\LLM Model\\llama.cpp\\desktop\\docs\\design\\preview\\ui-l2-carbon.html';
const html = readFileSync(file, 'utf8');
const probe = `<script>
window.addEventListener('load', function(){ setTimeout(function(){
  var out=[]; function P(s){ out.push(s); }
  function R(e){ var r=e.getBoundingClientRect(); return Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height); }
  var win=document.getElementById('win'), vp=document.getElementById('viewport');
  P('window            : '+R(win)+' scrollH='+win.scrollHeight+' clientH='+win.clientHeight);
  P('viewport(clip)    : '+R(vp)+' scrollH='+vp.scrollHeight+' clientH='+vp.clientHeight);
  P('titlebar+nav      : '+R(document.querySelector('.win-cap'))+' '+R(document.querySelector('.navbar')));
  var view=document.getElementById('view-run');
  P('view-run          : '+R(view)+' scrollH='+view.scrollHeight+' clientH='+view.clientHeight);
  var rc=document.getElementById('rigList'), rp=document.getElementById('resPanel');
  P('rigList           : '+R(rc)+' scrollH='+rc.scrollHeight+' clientH='+rc.clientHeight);
  P('resPanel          : '+R(rp)+' scrollH='+rp.scrollHeight+' clientH='+rp.clientHeight);
  var cards=document.querySelectorAll('#rigList > .rig');
  P('purpose cards     : n='+cards.length+' first='+R(cards[0])+' last='+R(cards[cards.length-1]));
  var last=cards[cards.length-1];
  P('last card bottom  : '+Math.round(last.getBoundingClientRect().bottom)+' vs rigList bottom '+Math.round(rc.getBoundingClientRect().bottom));
  var drawer=document.getElementById('drawer');
  P('drawer (closed)   : '+R(drawer));
  P('document          : scrollW='+document.documentElement.scrollWidth+' innerW='+window.innerWidth+' scrollH='+document.documentElement.scrollHeight+' innerH='+window.innerHeight);
  P('font check 300    : document.fonts.check("300 20px \\"Segoe UI Light\\"")='+document.fonts.check('300 20px "Segoe UI Light"'));
  P('font check Noto   : document.fonts.check("300 20px \\"Noto Sans SC Light\\"")='+document.fonts.check('300 20px "Noto Sans SC Light"'));
  P('font check Casc   : document.fonts.check("400 12px \\"Cascadia Mono\\"")='+document.fonts.check('400 12px "Cascadia Mono"'));
  var p=document.createElement('pre'); p.id='diagout'; p.textContent=out.join('\\n'); document.body.appendChild(p);
},250); });
<\/script>`;
const out = join(tmpdir(), 'l2-lay.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log(out);
