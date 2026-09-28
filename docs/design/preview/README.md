# 设计预览与对照

## 怎么看

| 方式 | 怎么做 | 适合 |
|---|---|---|
| **并排查看器** | 双击 [compare.html](compare.html) | **推荐**。一处切换四版 + 一张并排快照，`1`–`5` 切版、`←/→` 前后翻、`0` 切适宽/1:1 |
| **单独打开** | 双击下表的任一个 HTML | 想在独立窗口里长时间把玩某一版 |
| **静态快照** | 看 [shots/](shots) 里的 PNG，或 compare.html 的「并排快照」页 | 只想一眼比完四版，不做交互 |

五份页面都是**单文件、完全离线**（零外链、零网络字体），浏览器直接打开即可，无需起服务器。

## 文件

| 文件 | 设计依据 | 视觉世界 |
|---|---|---|
| [ui-preview.html](ui-preview.html) | 自定方向「工业控制台」 | 石墨底 `#0d0f12` + 电光蓝 `#4c9aff`，圆角 3–9px 混用，卡片 + 投影，画 1120×780 窗口外框 |
| [ui-v1-taste.html](ui-v1-taste.html) | `design-taste-frontend` | 暖石纸面 `#f4f1ec` + 赭褐 `#9c4a24`，圆角只有 `0/1px/2px`，**零 box-shadow**，密度 9 |
| [ui-v2-hallmark.html](ui-v2-hallmark.html) | `hallmark` | 瓷白 `oklch(97.4% .006 210)` + 墨青 `oklch(38% .058 205)`，**全部 OKLCH 命名令牌**，**不画假窗口外框**（gate 47），Cambria 正体显示字 |
| [ui-v3-impeccable.html](ui-v3-impeccable.html) | `impeccable`（Operate 模式） | 搪瓷灰 `#d5d7d2` + 松绿 `#08423a`，圆角仅 `1px`，刻蚀线分层，`::selection` 已主题化 |
| [ui-wireframe.html](ui-wireframe.html) | 结构规格 | 中性线框，102 个控件各自带功能/可用条件/关联控件标注 |

三版由独立子代理按各自技能生成（V2 另写了 [`.hallmark/log.json`](../../../.hallmark/log.json)）；**验收由我用同一套工具重跑**，不采信自我报告。

## 验收工具

```powershell
cd docs\design\preview
.\verify-preview.ps1 -File .\ui-v1-taste.html              # 默认 1440x900
.\verify-preview.ps1 -File .\ui-v3-impeccable.html -Width 900 -Height 700   # 窄屏
```

- [verify-preview.mjs](verify-preview.mjs)：静态检查（标签配平 / 重复 id / 悬空 `data-rel`·`data-jump` / 外链 / 内联脚本语法）+ 注入交互探针
- [verify-preview.ps1](verify-preview.ps1)：无头 Chrome 驱动，按**可见文本**定位控件（四版 id 各不相同，文本才是共同契约）

**四个已知的坑**（都踩过）：

1. 探针结果必须写进 DOM（`<pre id="dshverifyout">`）再取回——Chrome 的 `--dump-dom` 不输出 console。
2. 注入探针不要用 PowerShell 的 `-replace`，也**不要**用 JS 的 `String.replace(str, replacement)`——后者会解释替换串里的 `$$` / `$&` / `` $` `` / `$'`，静默改写脚本。传替换**函数**。
3. `.ps1` 保持纯 ASCII：Windows PowerShell 无 BOM 时按 ANSI 读脚本，中文注释会破坏语法解析。
4. 判可见性要用 `innerText`，不能用 `textContent`——隐藏模态的文字仍在 DOM 里。

## 验收结果（2026-09-29）

| 文件 | 字节 | 行数 | data-fn | 外链 | 静态悬空 | 交互探针 |
|---|---|---|---|---|---|---|
| ui-preview.html | 91 147 | 1 137 | 53 | 0 | `card-chat`（运行时生成，运行期 20/20 命中） | **30 / 30** |
| ui-v1-taste.html | 104 244 | 1 288 | 84 | 0 | 无 | **30 / 30** |
| ui-v2-hallmark.html | 153 467 | 1 967 | 130 | 0 | `card-ov`/`card-chat`/`row-reranker`（同上，运行期 53/53 命中） | **30 / 30** |
| ui-v3-impeccable.html | 145 971 | 1 802 | 69 | 0 | 无 | **30 / 30** |

探针覆盖 30 项：用途卡与资源面渲染、真实数字对账、**链路 9 全流程**（预检打开 → 走「停掉它」出口 → 模态关闭且转入切换）、三场景切换、抽屉两场景差异、四视图、三页签、五模态开合且全关、**多行为控件三个行为都生效**、**运行时关联引用全命中**、标注面板、内联变更条、无横向溢出。

## 复验中发现并修掉的真缺陷

| # | 缺陷 | 影响 | 来源 |
|---|---|---|---|
| 1 | **`dataset.bound` 单标志幂等** | 同时带多个 `data-*` 行为的控件**只有第一个生效**：探测模态的「用这个形态继续」只跳页、关不掉模态。现任有 4 个这样的按钮；V1 照搬了同一实现，同病 | V2 报告指出 → 我的探针加了回归检查证实 → 现任与 V1 均已改为事件委托 |
| 2 | 现任 4 个悬空关联引用 `exp-chat/exp-rr/exp-wk/exp-ly` | 单成员用途卡的可用性徽标指向不存在的成员块，悬停不高亮 | 我的运行时关联检查抓到 |
| 3 | 标注面板只有 focus 没有 blur | 焦点离开后面板留着上一个控件的说明，读起来像当前控件的属性 | V2 报告指出 → 已在现任补上 |
| 4 | V2 与 V3 把自查脚手架留在产物里 | `<pre id="probeout">` + `#probeout{display:none}` 进了交付文件（V2 重写后又回来一次，已再清） | 我的静态检查抓到 |
| 5 | 工具自身 5 个缺陷 | `textContent` 误计隐藏文本、父级 `span` 抢走点击、`素材` 命中`素材获取`、探针顺序污染、关联解析不认 `data-target` | 用现任做基准逐一暴露并修掉 |

## 必须说清的局限

**视觉正确性没有被人眼验证过。** 当前模型无图像输入，`read_image` 不可用，所以我能保证的是结构、行为、数据保真、令牌与对比度**数值**；"哪一版更好看"需要你自己打开判断。快照是给**你**看的，不是给我看的。

`shots/*.png` 由无头 Chrome 以 1520×1010 渲染，可随时重新生成：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
  --hide-scrollbars --window-size=1520,1010 --screenshot=shots\1-taste.png `
  "file:///D:/LLM%20Model/llama.cpp/desktop/docs/design/preview/ui-v1-taste.html"
```

## 维护约定

1. 可交互控件写三个属性：`data-fn`（功能）、`data-cond`（可用条件）、`data-rel`（关联锚点）。**可用条件是一等内容**。
2. 关联锚点可以写在 `id` 或 `data-target` 上；运行时探针两种都会解析。
3. 行为绑定用**事件委托**，不要给同一元素按属性各绑一次——一个元素可以同时带多个行为。
4. `<table>` / `<input>` / `<select>` 不能承载子元素，标注角标不要注入到这些标签上。
5. 改完跑一次 `verify-preview.ps1`；当前判定线 30 项，任一项 FAIL 即退出码 1。
