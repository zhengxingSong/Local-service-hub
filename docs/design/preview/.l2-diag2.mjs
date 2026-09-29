/* diagnostic 2: replicate the probe's visibleModals() exactly, step by step */
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
  function innermost(pool,t){
    var exact=pool.filter(function(e){ return e.textContent.trim()===t; });
    if(exact.length) pool=exact;
    var inner=pool.filter(function(e){ return !pool.some(function(o){ return o!==e && e.contains(o); }); });
    return (inner.length?inner:pool)[0]||null;
  }
  function byText(t,sel){
    var INTER=sel||'button,[role=button],a,input,label,summary';
    var hit=function(e){ return e.textContent.trim().indexOf(t)>=0; };
    var inter=all(INTER,document).filter(hit).filter(vis);
    if(inter.length) return innermost(inter,t);
    var any=all('button,[role=button],a,label,div,span,td,li',document).filter(hit);
    return innermost(any.filter(vis),t)||innermost(inter,t)||innermost(any,t);
  }
  function visibleModals(){
    return all('div').filter(function(e){ var r=e.getBoundingClientRect();
      return vis(e) && r.width>200 && r.height>120 && /modal|mw|dialog/i.test(e.className); }).length;
  }
  function body(){ return document.body.innerText||document.body.textContent; }
  var chatCard = byText('聊天组','div,section,article,li');
  P('chatCard tag='+chatCard.tagName+' cls="'+chatCard.className+'" id='+(chatCard.id||'-'));
  var enableBtn=null;
  if(chatCard){
    var scopes=[chatCard].concat(all('div,section,article,li').filter(function(e){ return e.textContent.indexOf('聊天组')>=0; }));
    P('scopes='+scopes.length);
    for(var i=0;i<scopes.length&&!enableBtn;i++){
      enableBtn=all('button,[role=button]',scopes[i]).filter(function(b){ return /启用|启动/.test(b.textContent); })[0]||null;
    }
  }
  P('enableBtn='+(enableBtn?('"'+enableBtn.textContent.trim()+'" cls='+enableBtn.className):'NULL'));
  P('visibleModals BEFORE='+visibleModals());
  if(enableBtn){ enableBtn.click(); }
  P('visibleModals AFTER='+visibleModals());
  P('pre class='+document.getElementById('m-pre').className);
  P('has 需要先处理='+(body().indexOf('需要先处理')>=0)+' 无法启动='+(body().indexOf('无法启动')>=0));
  var cancel=all('button,[role=button]').filter(function(b){ return b.textContent.trim()==='取消'&&vis(b); })[0];
  if(cancel) cancel.click();
  P('visibleModals AFTER cancel='+visibleModals());
  P('pre class after cancel='+document.getElementById('m-pre').className);
  var p=document.createElement('pre'); p.id='diagout'; p.textContent=out.join('\\n'); document.body.appendChild(p);
},150); });
<\/script>`;

const out = join(tmpdir(), 'l2-diag2.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log(out);
