/* diagnostic 6: which action in the config-tab sequence opens m-asset? */
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
  function chain(){ return all('.mw').map(function(m){return m.id+(m.classList.contains('on')?'+':'-');}).join(','); }
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
    if(inter.length){ P('  byText('+t+') INTER hits='+inter.length+' first=<'+inter[0].tagName+' class='+inter[0].className+'>'); return innermost(inter,t); }
    var any=all('button,[role=button],a,label,div,span,td,li',document).filter(hit);
    var r=innermost(any.filter(vis),t)||innermost(inter,t)||innermost(any,t);
    P('  byText('+t+') FALLBACK pick=<'+r.tagName+' class='+r.className+'>');
    return r;
  }
  function clickText(t,sel){ var e=byText(t,sel); if(!e){P('  MISS '+t);return false;} P('  click '+t+' -> <'+e.tagName+' class='+e.className+'>'); e.click(); return true; }

  P('start chain='+chain());
  clickText('配置'); P('after 配置 chain='+chain());
  clickText('素材');  P('after 素材  chain='+chain());
  clickText('预设组'); P('after 预设组 chain='+chain());
  clickText('服务');  P('after 服务  chain='+chain());
  clickText('服务编辑'); P('after 服务编辑 chain='+chain());
  clickText('设置'); P('after 设置 chain='+chain());
  clickText('运行'); P('after 运行 chain='+chain());
  var p=document.createElement('pre'); p.id='diagout'; p.textContent=out.join('\\n'); document.body.appendChild(p);
},150); });
<\/script>`;

const out = join(tmpdir(), 'l2-diag6.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log(out);
