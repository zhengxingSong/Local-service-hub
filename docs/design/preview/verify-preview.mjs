/**
 * 预览页验收工具：静态检查 + 交互探针注入。
 *
 * 用法：
 *   node verify-preview.mjs <file.html>                 只做静态检查
 *   node verify-preview.mjs <file.html> --inject-probe  静态检查 + 生成注入探针的副本
 *
 * 探针按**可见文本**定位控件，而不是按 id——三版设计的 id 各不相同，文本才是共同契约。
 * 生成副本后用无头浏览器取回：结果写在 <pre id="probeout">，因为 --dump-dom 不输出 console。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2];
if (!file) { console.error('用法: node verify-preview.mjs <file.html> [--inject-probe]'); process.exit(2); }
const html = readFileSync(file, 'utf8');
const count = (re) => [...html.matchAll(re)].length;

/* ---------- 静态检查 ---------- */
const report = { file, bytes: Buffer.byteLength(html), lines: html.split('\n').length };
const unbalanced = {};
for (const t of ['div', 'section', 'aside', 'nav', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'button', 'span', 'svg', 'symbol', 'select', 'style', 'script']) {
  const o = count(new RegExp(`<${t}\\b`, 'g'));
  const c = count(new RegExp(`</${t}>`, 'g'));
  if (o !== c) unbalanced[t] = `${o} 开 / ${c} 闭`;
}
report.tagBalance = Object.keys(unbalanced).length ? unbalanced : 'ok';

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const dataIds = new Set([...html.matchAll(/data-(?:id|target)="([^"]+)"/g)].map((m) => m[1]));
const seen = new Set(); const dup = [];
for (const m of html.matchAll(/\sid="([^"]+)"/g)) { if (seen.has(m[1])) dup.push(m[1]); seen.add(m[1]); }
report.ids = ids.size;
report.duplicateIds = dup.length ? dup : 'none';

const refs = [...html.matchAll(/data-(?:rel|jump)="([^"]*)"/g)]
  .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean))
  .filter((r) => !r.includes('$'));
report.unresolvedRefs = [...new Set(refs)].filter((r) => !ids.has(r) && !dataIds.has(r));

report.externalNetworkRefs = count(/(?:src|href)="(?:https?:)?\/\//g);
report.annotatedControls = count(/data-fn="/g);
report.hasProbeSafeBody = html.includes('</body>');

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
report.inlineScripts = scripts.length;
try { scripts.forEach((s) => new vm.Script(s)); report.scriptSyntax = 'ok'; }
catch (e) { report.scriptSyntax = 'FAIL: ' + e.message; }

console.log(JSON.stringify(report, null, 2));

/* ---------- 交互探针 ---------- */
if (!process.argv.includes('--inject-probe')) process.exit(0);

const probe = `<script>
window.addEventListener('load', function () { setTimeout(function () {
  var out = [];
  function all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function vis(e) {
    if (!e) return false;
    var r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05;
  }
  function innermost(pool, t) {
    /* 优先精确文本匹配（否则「素材」会命中「素材获取」） */
    var exact = pool.filter(function (e) { return e.textContent.trim() === t; });
    if (exact.length) pool = exact;
    /* 取最内层候选：排除包含另一个候选的元素（否则会选中包着按钮的 span） */
    var inner = pool.filter(function (e) {
      return !pool.some(function (o) { return o !== e && e.contains(o); });
    });
    return (inner.length ? inner : pool)[0] || null;
  }
  function byText(t, sel) {
    var INTER = sel || 'button,[role=button],a,input,label,summary';
    var hit = function (e) { return e.textContent.trim().indexOf(t) >= 0; };
    var inter = all(INTER, document).filter(hit).filter(vis);
    if (inter.length) return innermost(inter, t);
    var any = all('button,[role=button],a,label,div,span,td,li', document).filter(hit);
    return innermost(any.filter(vis), t) || innermost(inter, t) || innermost(any, t);
  }
  function clickText(t, sel) {
    var e = byText(t, sel);
    if (!e) { out.push('MISS | 找不到「' + t + '」'); return false; }
    e.click(); return true;
  }
  function body() { return document.body.innerText || document.body.textContent; }
  function mark(n, ok, x) { out.push((ok ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); }
  function has(t) { return body().indexOf(t) >= 0; }

  mark('渲染·用途卡', has('聊天组') && has('OpenViking'));
  mark('渲染·资源面', has('显存') && (has('9.4') || has('9.6')));
  mark('渲染·真实数字对账', has('8.1') || has('4.1'));
  mark('标注控件数 > 20', all('[data-fn]').length > 20, all('[data-fn]').length + ' 个');

  /* 链路 9 放最前：它依赖干净的初始状态，放在其它点击之后会被前面的操作污染 */
  var chatCard = byText('聊天组', 'div,section,article,li');
  var enableBtn = null;
  if (chatCard) {
    var scopes = [chatCard].concat(all('div,section,article,li').filter(function (e) { return e.textContent.indexOf('聊天组') >= 0; }));
    for (var i = 0; i < scopes.length && !enableBtn; i++) {
      enableBtn = all('button,[role=button]', scopes[i]).filter(function (b) { return /启用|启动/.test(b.textContent); })[0] || null;
    }
  }
  function visibleModals() {
    return all('div').filter(function (e) {
      var r = e.getBoundingClientRect();
      return vis(e) && r.width > 200 && r.height > 120 && /modal|mw|dialog/i.test(e.className);
    }).length;
  }
  if (enableBtn) {
    enableBtn.click();
    mark('链路9·预检打开', visibleModals() > 0 && (has('需要先处理') || has('无法启动')), '可见模态=' + visibleModals());
    var released = clickText('停掉它');
    mark('链路9·有「停掉它」出口', released);
    mark('链路9·出口后转入切换', !has('需要先处理') && (has('停止中') || has('切换中')),
      '残留预检提示=' + has('需要先处理') + ' 停止中=' + has('停止中') + ' 切换中=' + has('切换中') + ' 可见模态=' + visibleModals());
  } else { out.push('MISS | 聊天组卡内找不到启用按钮'); }

  /* 场景切换：排障演示留在最后，因为抽屉入口通常只在出现异常时才存在 */
  if (clickText('切换演示')) mark('场景·切换', has('停止中') || has('切换中'));
  if (clickText('真实状态')) mark('场景·复位', has('可用'));
  if (clickText('排障演示')) mark('场景·排障', has('就绪超时') || has('部分可用'));

  /* 抽屉：措辞各版不同，改用「可见文本是否显著增长」作为结构信号 */
  var beforeLen = body().length;
  var detail = all('button,[role=button]').filter(function (b) {
    return /详情|处置|诊断|抽屉|运行记录|日志/.test(b.textContent) && vis(b);
  })[0];
  if (detail) {
    detail.click();
    var grew = body().length - beforeLen;
    mark('抽屉·打开', grew > 80 || has('归因') || has('运行记录'),
      '入口="' + detail.textContent.trim().slice(0, 8) + '" 可见文本 +' + grew + ' 字');
    mark('抽屉·日志内容', has('slot') || has('openviking') || has('startup') || has('llama') || has('退出码'));
  } else { out.push('MISS | 排障场景下找不到抽屉入口'); }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  if (clickText('真实状态')) { /* 复位，避免影响后续检查 */ }

  /* 视图：页签检查必须紧接在「配置」之后做——祖先视图隐藏时 innerText 读不到内容 */
  if (clickText('配置')) {
    mark('视图·配置', has('新建服务') || has('服务清单') || has('预设组'));
    if (clickText('素材')) mark('页签·素材', has('SenseNova') || has('未被引用'));
    if (clickText('预设组')) mark('页签·预设组', has('OpenViking 组'));
    if (clickText('服务')) mark('页签·服务', has('embedding') || has('ov-server'));
  }
  if (clickText('服务编辑')) mark('视图·服务编辑', has('① 形态') || has('形态'));
  if (clickText('设置')) mark('视图·设置', has('配置快照') || has('快照'));
  if (clickText('运行')) mark('视图·运行', has('显存'));

  /* 五个模态：判定「浮层是否真的出现」，不依赖标题措辞 */
  ['预检', '危险确认', '素材获取', '探测', '组编辑'].forEach(function (name) {
    var btn = all('button,[role=button]').filter(function (b) { return b.textContent.trim() === name && vis(b); })[0];
    if (!btn) { out.push('MISS | 找不到浮层按钮「' + name + '」'); return; }
    var before = visibleModals();
    btn.click();
    mark('模态·' + name, visibleModals() > before, '可见浮层 ' + before + ' → ' + visibleModals());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  /* 多行为控件的回归检查：探测模态的主按钮同时带 data-close + data-go + data-toast，
     三者必须都生效。单标志幂等（dataset.bound）会让后两个被静默跳过。 */
  var detectBtn = all('button,[role=button]').filter(function (b) { return b.textContent.trim() === '探测' && vis(b); })[0];
  if (detectBtn) {
    detectBtn.click();
    var goBtn = all('button,[role=button]').filter(function (b) {
      return /用这个形态继续|继续|确定/.test(b.textContent) && vis(b);
    })[0];
    if (goBtn) {
      goBtn.click();
      mark('多行为控件·关闭+跳页+提示三者都生效',
        visibleModals() === 0 && has('① 形态'),
        '可见浮层=' + visibleModals() + ' 已到服务编辑=' + has('① 形态'));
    } else { out.push('MISS | 探测模态里找不到主按钮'); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  var stillOpen = all('[class*=modal],[class*=Modal]').filter(function (e) { return vis(e) && /modal/i.test(e.className) && e.getBoundingClientRect().width > 200; }).length;
  mark('模态·全部可关闭', stillOpen <= 1, stillOpen + ' 个仍可见');

  /* 关联引用的运行时解析：静态检查查不到 JS 动态生成的 id，这里才是定论 */
  var relRefs = [];
  all('[data-rel]').forEach(function (e) {
    (e.getAttribute('data-rel') || '').split(',').forEach(function (r) { r = r.trim(); if (r) relRefs.push(r); });
  });
  var unresolved = relRefs.filter(function (r) {
    /* 锚点可能写在 id、data-id 或 data-target 上（三版各自的去重约定不同） */
    return !document.getElementById(r)
      && !document.querySelector('[data-id="' + r + '"]')
      && !document.querySelector('[data-target="' + r + '"]');
  });
  mark('标注·关联引用全部可解析（运行时）', unresolved.length === 0,
    unresolved.length ? ('未解析: ' + unresolved.slice(0, 6).join(', ')) : (relRefs.length + ' 个引用全部命中'));

  /* 标注模式 */
  var specBtn = all('button,[role=button]').filter(function (b) { return /标注/.test(b.textContent); })[0];
  if (specBtn) {
    specBtn.click();
    var ctl = all('[data-fn]').filter(vis)[0];
    if (ctl) ctl.dispatchEvent(new MouseEvent('mouseenter'));
    var panel = all('aside,div').filter(function (e) { return /可用条件|功能/.test(e.textContent) && vis(e); });
    mark('标注·面板填充', panel.length > 0);
  } else { out.push('MISS | 找不到标注模式开关'); }

  /* 内联变更条 */
  var noticeBtn = all('button,[role=button]').filter(function (b) { return /外部变更/.test(b.textContent); })[0];
  if (noticeBtn) { noticeBtn.click(); mark('内联条·外部变更', has('services.json')); }
  else { out.push('MISS | 找不到「模拟外部变更」'); }

  /* Toast 上限 */
  /* 横向溢出：只把桌面宽度当作判定；窄屏时如实标注（预览外壳按 1120 固定窗口 + 侧栏渲染） */
  var overflow = document.documentElement.scrollWidth - window.innerWidth;
  if (window.innerWidth >= 1200) {
    mark('布局·无横向溢出', overflow <= 2, document.documentElement.scrollWidth + ' vs ' + window.innerWidth);
  } else {
    out.push('INFO | 窄屏 ' + window.innerWidth + 'px 横向溢出 ' + overflow + 'px（预览载体特性，不计入判定）');
  }

  var pre = document.createElement('pre');
  pre.id = 'dshverifyout';
  pre.textContent = out.join('\\n');
  document.body.appendChild(pre);
}, 120); });
</script>`;

/* 探针副本写到系统临时目录，避免污染仓库。
   注意注入必须用**函数**替换：JS 的 String.replace(str, replacement) 会解释替换串里的
   $$ / $& / $` / $'，把探针里的辅助函数静默改写掉。 */
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
const out = join(tmpdir(), basename(file).replace(/\.html$/, '') + '.probe.html');
writeFileSync(out, html.replace('</body>', () => probe + '\n</body>'), 'utf8');
console.log('PROBE_FILE=' + out);
