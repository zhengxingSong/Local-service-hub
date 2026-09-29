/* diagnostic 3: list every element the probe's visibleModals() counts */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = 'D:\\LLM Model\\llama.cpp\\desktop\\docs\\design\\preview\\ui-l2-carbon.html';
const html = readFileSync(file, 'utf8');

const probe = `<script>
window.addEventListener('load', function(){ setTimeout(function(){
  var out=[]; function P(s){ out.push(s); }
  function all(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
  function vis(e){ if(!e) return false; var r=e.getBoundingClientRect(), s=getComputedStyle(e);
    return r.width>1 && r.height>1 && s.display!=='none' && s.visibility!=='hidden' && parseFloat(s.opacity)>0.05; }
  function counted(tag){
    var hits = all('div').filter(function(e){ var r=e.getBoundingClientRect();
      return vis(e) && r.width>200 && r.height>120 && /modal|mw|dialog/i.test(e.className); });
    P(tag+' counted='+hits.length+' :: '+hits.map(function(e){ var r=e.getBoundingClientRect();
      return (e.id||'-')+'['+e.className+'] '+Math.round(r.width)+'x'+Math.round(r.height); }).join(' | '));
  }
  counted('INIT');
  var chat = all('div,section,article,li').filter(function(e){ return e.textContent.indexOf('聊天组')>=0; })
    .filter(function(e){ return !all('div,section,article,li',e).some(function(o){ return o!==e && e.contains(o) && o.textContent.indexOf('聊天组')>=0; }); })[0];
  var btn = all('button,[role=button]', chat).filter(function(b){ return /启用|启动/.test(b.textContent); })[0];
  P('btn='+(btn?btn.textContent.trim():'NULL')+' scope='+chat.className);
  if (btn) btn.click();
  counted('AFTER-CLICK');
  P('scenario class on pre='+document.getElementById('m-pre').className);
  /* now the detect-modal path */
  var det = all('button,[role=button]').filter(function(b){ return b.textContent.trim()==='探测' && vis(b); })[0];
  P('detect btn found='+!!det);
  if (det) det.click();
  counted('AFTER-DETECT');
  var go = all('button,[role=button]').filter(function(b){ return /用这个形态继续|继续|确定/.test(b.textContent) && vis(b); })[0];
  P('goBtn='+(go?('"'+go.textContent.trim()+'"'):'NULL'));
  if (go) { go.click(); }
  counted('AFTER-GO');
  P('view-edit on='+document.getElementById('view-edit').className);
  P('has 形态='+(document.body.innerText.indexOf('① 形态')>=0));
  P('modal count now='+all('[class*=modal],[class*=Modal]').filter(function(e){ return vis(e)&&/modal/i.test(e.className)&&e.getBoundingClientRect().width>200; }).length);
  var p=document.createElement('pre'); p.id='diagout'; p.textContent=out.join('\\n'); document.body.appendChild(p);
},150); });
<\/script>`;

const out = join(tmpdir(), 'l2-diag3.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log(out);
