/* diagnostic 4: trace the multi-behaviour path + modal close */
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
  function vm(){ return all('div').filter(function(e){ var r=e.getBoundingClientRect();
    return vis(e) && r.width>200 && r.height>120 && /modal|mw|dialog/i.test(e.className); }).length; }
  function views(){ return all('.view').map(function(v){ return v.id+'='+(v.classList.contains('on')?'ON':'off'); }).join(' '); }

  /* ——— 第一步：重现「模态·预检」失败 ——— */
  var pre = all('button,[role=button]').filter(function(b){ return b.textContent.trim()==='预检' && vis(b); })[0];
  P('pre btn='+(pre?pre.textContent.trim():'NULL')+' vm='+vm());
  if (pre) pre.click();
  P('after pre click vm='+vm()+' m-pre='+document.getElementById('m-pre').className);
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  P('after ESC vm='+vm()+' m-pre='+document.getElementById('m-pre').className+' scrim='+document.getElementById('scrim').className);

  /* ——— 第二步：多行为控件 ——— */
  document.body.classList.remove('spec');
  var det = all('button,[role=button]').filter(function(b){ return b.textContent.trim()==='探测' && vis(b); })[0];
  P('detect='+(det?('id='+(det.id||'-')+' cls='+det.className):'NULL'));
  if (det) det.click();
  P('after detect vm='+vm()+' views: '+views());
  var go = all('button,[role=button]').filter(function(b){ return /用这个形态继续|继续|确定/.test(b.textContent) && vis(b); })[0];
  P('go='+(go?('"'+go.textContent.trim()+'" attrs='+go.getAttribute('data-close')+'/'+go.getAttribute('data-view')+'/'+(go.getAttribute('data-toast')||'').slice(0,12)):'NULL'));
  if (go) go.click();
  P('after go vm='+vm()+' views: '+views());
  P('m-detect cls='+document.getElementById('m-detect').className);
  P('has ① 形态='+(document.body.innerText.indexOf('① 形态')>=0));
  var p=document.createElement('pre'); p.id='diagout'; p.textContent=out.join('\\n'); document.body.appendChild(p);
},150); });
<\/script>`;

const out = join(tmpdir(), 'l2-diag4.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log(out);
