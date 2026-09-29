/* diagnostic 5: why is innerText missing the edit view's text right after the click? */
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
  function B(){ return document.body.innerText||document.body.textContent; }
  function V(){ return all('.view').map(function(v){return v.id+'='+(v.classList.contains('on')?'ON':'off');}).join(' '); }

  var det = all('button,[role=button]').filter(function(b){ return b.textContent.trim()==='探测' && vis(b); })[0];
  det.click();
  var go = all('button,[role=button]').filter(function(b){ return /用这个形态继续|继续|确定/.test(b.textContent) && vis(b); })[0];
  go.click();

  var ve = document.getElementById('view-edit');
  P('views: '+V());
  P('view-edit display='+getComputedStyle(ve).display+' rect='+JSON.stringify(ve.getBoundingClientRect()));
  P('innerText 形态='+(B().indexOf('① 形态')>=0)+' textContent 形态='+(document.body.textContent.indexOf('① 形态')>=0));
  P('ve.innerText 形态='+(ve.innerText.indexOf('① 形态')>=0)+' ve.textContent 形态='+(ve.textContent.indexOf('① 形态')>=0));
  P('innerText len='+B().length+' textContent len='+document.body.textContent.length+' ve.innerText len='+ve.innerText.length);
  var f = document.getElementById('editform');
  P('editform exists='+!!f+' rect='+(f?JSON.stringify(f.getBoundingClientRect()):'-'));
  var h = document.getElementById('sec-1');
  P('sec-1 exists='+!!h+' rect='+(h?JSON.stringify(h.getBoundingClientRect()):'-'));
  P('sec-1 innerText head="'+(h?h.innerText.slice(0,60).replace(/\\n/g,'|'):'-')+'"');
  P('body innerText head="'+B().slice(0,160).replace(/\\n/g,'|')+'"');
  var p=document.createElement('pre'); p.id='diagout'; p.textContent=out.join('\\n'); document.body.appendChild(p);
},150); });
<\/script>`;

const out = join(tmpdir(), 'l2-diag5.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log(out);
