/* one-off diagnostic: why does visibleModals() see 0 after clicking 启用? */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = 'D:\\LLM Model\\llama.cpp\\desktop\\docs\\design\\preview\\ui-l2-carbon.html';
const html = readFileSync(file, 'utf8');

const probe = `<script>
window.addEventListener('load', function(){ setTimeout(function(){
  var out = [];
  function all(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
  function vis(e){ if(!e) return false; var r=e.getBoundingClientRect(), s=getComputedStyle(e);
    return r.width>1 && r.height>1 && s.display!=='none' && s.visibility!=='hidden' && parseFloat(s.opacity)>0.05; }
  function report(tag){
    all('.mdl').forEach(function(m){
      var r=m.getBoundingClientRect(), s=getComputedStyle(m);
      out.push(tag+' #'+m.id+' cls='+m.className+' vis='+vis(m)+' disp='+s.display+' w='+Math.round(r.width)+' h='+Math.round(r.height));
    });
    out.push(tag+' scrim='+document.getElementById('scrim').className+' bodySpec='+document.body.className);
  }
  report('INIT');
  var chat = all('div,section,article,li').filter(function(e){ return e.textContent.indexOf('聊天组')>=0; })
    .filter(function(e){ return !all('div,section,article,li',e).some(function(o){ return o!==e && e.contains(o) && o.textContent.indexOf('聊天组')>=0; }); });
  out.push('chatCandidates='+chat.length+' first='+(chat[0]?chat[0].id||chat[0].className:'-'));
  var card = chat[0];
  var btns = card ? all('button,[role=button]', card).filter(function(b){ return /启用|启动/.test(b.textContent); }) : [];
  out.push('btns='+btns.length+' txt='+(btns[0]?btns[0].textContent.trim():'-'));
  if (btns[0]) {
    try { btns[0].click(); } catch(err){ out.push('CLICK-THREW '+err.message); }
    report('AFTER');
  }
  var pre = document.getElementById('m-pre');
  out.push('pre exists='+!!pre+' cls='+(pre?pre.className:'-'));
  out.push('docErr='+(window.__err||'none'));
  var p=document.createElement('pre'); p.id='diagout'; p.textContent=out.join('\\n'); document.body.appendChild(p);
},150); });
window.addEventListener('error', function(e){ window.__err=(window.__err||'')+e.message+' @'+e.lineno; });
<\/script>`;

const out = join(tmpdir(), 'l2-diag.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log(out);
