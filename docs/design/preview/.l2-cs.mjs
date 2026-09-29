import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const file = 'D:\\LLM Model\\llama.cpp\\desktop\\docs\\design\\preview\\ui-l2-carbon.html';
const html = readFileSync(file, 'utf8');
const probe = `<script>
window.addEventListener('load', function(){ setTimeout(function(){
  var out=[]; function P(s){ out.push(s); }
  function cs(sel, props){
    var e = sel.indexOf('#') === 0 || sel.indexOf('.') === 0 ? document.querySelector(sel) : document.querySelector(sel);
    if (!e) { P(sel + ' :: NOT FOUND'); return; }
    var s = getComputedStyle(e), a = [];
    props.forEach(function(p){ a.push(p + '=' + s.getPropertyValue(p)); });
    P(sel + ' :: ' + a.join(' | '));
  }
  var box = ['border-radius','border-top-width','border-top-color','background-color','box-shadow','font-family','font-size','font-weight','letter-spacing','height','width'];
  var txt = ['font-family','font-size','font-weight','line-height','letter-spacing','color'];
  cs('#win', box);
  cs('.band .tt', txt);
  cs('.pv-title .t', txt);
  cs('.readout .big', txt);
  cs('#view-settings .card-h .nm', txt);
  cs('.btn', box);
  cs('.mdl'.replace('mdl','mw'), box);
  cs('#m-pre .mp-h .nm', txt);
  cs('.tbl th', txt);
  cs('.tbl td', txt);
  cs('.chip', ['border-radius','border-top-color','background-color','font-size','height']);
  cs('.lamp', ['border-radius','width','height','background-color']);
  cs('.inp', box);
  cs('.note', ['font-size','line-height','color']);
  cs('.eyebrow', ['font-size','font-weight','letter-spacing','text-transform']);
  cs('.card', box);
  var p=document.createElement('pre'); p.id='diagout'; p.textContent=out.join('\\n'); document.body.appendChild(p);
},200); });
<\/script>`;
const out = join(tmpdir(), 'l2-cs.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log(out);
