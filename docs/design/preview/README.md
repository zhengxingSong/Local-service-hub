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
| [ui-v3-impeccable.html](ui-v3-impeccable.html) | `impeccable`（Operate 模式）+ 一轮现代精修 | 近白台面 `#f6f7f6` + 松绿 `#0a5348`，圆角 7/10/16，柔和投影，深色画布；量程账本与方格状态灯保留 |
| [ui-wireframe.html](ui-wireframe.html) | 结构规格 | 中性线框，102 个控件各自带功能/可用条件/关联控件标注 |
| [ui-l1-linear.html](ui-l1-linear.html) | `design-md-library` → `linear.app` | canvas `#010102` + 薰衣草蓝 `#5e6ad2`（只给主 CTA/焦点环/品牌标记）· 四级表面阶梯 + 发丝线，不用投影 · display 600 + 负字距 |
| [ui-l2-carbon.html](ui-l2-carbon.html) | `design-md-library` → `ibm`（Carbon） | 白底 + 唯一蓝 `#0f62fe` · **全 0px 直角**（一条别的圆角都没有）· **weight 300 展示字** · 正文 `0.16px` 字距 · 无卡片投影 |
| [ui-l3-clickhouse.html](ui-l3-clickhouse.html) | `design-md-library` → `clickhouse` | `#0a0a0a` 底 + 电黄 `#faff69` · **黄色同时承担 CTA 与统计读数**（资源账本整行只有黄数字）· 四层暗面 + 发丝线，零投影 |

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
| ui-v3-impeccable.html | 152 942 | 1 912 | 69 | 0 | 无 | **30 / 30** |
| ui-l1-linear.html | 135 215 | 1 670 | 127 | 0 | 无 | **30 / 30** |
| ui-l2-carbon.html | 188 160 | 2 660 | 188 | 0 | 无 | **30 / 30** |
| ui-l3-clickhouse.html | 157 639 | 1 985 | 137 | 0 | 无 | **30 / 30** |

### V3 的现代精修（refinement，未改结构与交互）

原版刻意走「台架仪器」世界，但具体手法用的是 9x 时代的 chrome 惯用法，所以读起来像古早软件。根因是量出来的，不是感觉：

| 过时手法 | 证据 | 换成 |
|---|---|---|
| **灰桌面 + 灰窗口** | `html,body{background:#a9ada8}`、`--face:#d5d7d2`（正是旧时代对话框的面板色） | 深色画布 `#171a1b` + 近白台面 `#f6f7f6`，窗口成为圆角浮层 |
| **全表零圆角** | 整个样式表只有一处 `border-radius:1px`（状态灯，刻意），其余全是硬直角 | 圆角体系：控件 7 / 面板 10 / 模态与窗口 12–16 / 芯片全圆 |
| **内凹斜面** | `inset 0 1px 0` 高光、`inset 0 2px 4px` 按下、`0 1px 0 var(--etch-lo)` 刻蚀双线 | 四级柔和投影（都带 offset 与模糊），按下用 inset 阴影 + `translateY(1px)` |
| **10px 起的小字、比值 1.14** | `--t-nano:10px`、`--t-base:12.5px` | 11px 起、基准 13px、比值 1.2 |
| **缺失的浏览器表面** | 无滚动条主题、无统一焦点环 | `::-webkit-scrollbar` 主题化、`:focus-visible` 统一 2px 强调色环 |

**保留的身份**：松绿强调色、方格状态灯（只从 1px 圆角改 3px 并去掉内描边）、量程账本签名件、刻线标牌母题、全部结构与交互。

**对比度复核**（13 组）：正文 16.5:1 · 次级 8.9:1 · 三级 5.7:1 · 表头 6.1:1 · 强调 8.3:1 · 主按钮 8.3:1 · 状态芯片 4.9–7.1:1，全部达标。**表单控件描边取 3.3:1**（输入框填充与台面几乎同色，描边是唯一识别手段，故必须 ≥3:1）；**按钮描边取 2.3:1、悬停 3.5:1** —— 这是一处有意的取舍：按钮有文字标签共同承担识别，30 多个按钮若都用 3.3:1 会明显过重。这条是判断，不是合规声明。

**量化前后差异**（同尺寸截图对比）：画布 `(170,174,169)` → `(33,36,36)`；窗口内均值 `(210,213,209)` → `(241,243,242)`；窗口内标准差 `26.6` → `27.2`（结构复杂度未被磨平）。前后快照见 [shots/3-impeccable-before.png](shots/3-impeccable-before.png) 与 [shots/3-impeccable.png](shots/3-impeccable.png)，查看器里有「V3 精修前后」对照页。

探针覆盖 30 项：用途卡与资源面渲染、真实数字对账、**链路 9 全流程**（预检打开 → 走「停掉它」出口 → 模态关闭且转入切换）、三场景切换、抽屉两场景差异、四视图、三页签、五模态开合且全关、**多行为控件三个行为都生效**、**运行时关联引用全命中**、标注面板、内联变更条、无横向溢出。

## 设计库驱动的三版（`design-md-library`）

从技能库的 74 份真实设计系统分析里，按「用途 + 展现形式」选了 3 份：库中大部分是摄影主导的营销页（汽车/时尚/消费品牌），不适合桌面运维控制台。入选理由是**产品 UI 先例**与**数据密集的规格**：

| 选用 | 它做对了而别人没做的事 |
|---|---|
| `linear.app` | 全库最深地板 `#010102`；**四级表面阶梯 + 发丝线**承载层级，明确"在深色上几乎完全抵制投影" |
| `ibm`（Carbon） | 全库唯一真正的企业设计系统，为表格/表单而生；**全 0px 直角**（"连 4px 圆角都会破坏观感"）+ **weight 300 做展示字**（"忍不住加粗就变普通了"）+ 正文 `0.16px` 字距 |
| `clickhouse` | **电黄同时承担 CTA 与统计读数**——把数字本身变成品牌电压；"无投影，深度靠 `#0a0a0a` 与 `#1a1a1a` 的差" |

落选但接近：`raycast`（与 Linear 同属"近黑 + 发丝"，两版会趋同）、`supabase`（浅色但与 Carbon 重叠）、`sentry`（紫 + 荧光绿，离"运维"略远）。

三版都把该文件的**令牌名带进产物**并在注释里标来源（如 `/* linear: colors.primary */`），颜色/字号/间距/圆角四组齐全；都按技能第 5 步要求区分了「照搬」与「延伸到参照没有的表面」，并逐条核对了各文件 `## Do's and Don'ts`。

### 我独立复核的规则遵守情况（不是采信自述）

| 规则 | L1 Linear | L2 Carbon | L3 ClickHouse |
|---|---|---|---|
| 圆角 | 按钮 `rounded.md` 8px、卡片 `lg` 12px，CTA 非全圆 ✅ | **只有 `--rounded-none` 一种取值**，10 处全部 0px ✅ | 按钮 `md` 7px（参照 8px 的 0.5× 等比收敛，已在报告声明），pill 只给 chip ✅ |
| 强调色用途 | 薰衣草蓝只出现在品牌标记/主 CTA/焦点环/状态派生，**0 处区块底或卡片填充** ✅ | 蓝只用于链接/焦点环/按钮/勾选态/输入聚焦，**0 处卡片底**，眉标是灰不是蓝 ✅ | 黄只用于 CTA/统计读数/数据标签/代码/状态/选中态，**无黄底正文块** ✅ |
| 深度 | 禁用真黑（`#010102`），投影只在模态/抽屉/Toast ✅ | `--elev-panel` 只落在 `.win`/`.mw`/`.drawer`/`.toast`，**没有卡片用它** ✅ | 零投影，只有 1 处 `--shadow-window` 给窗口框 ✅ |
| 排版签名 | 负字距以令牌实现（`--ls-display-md:-0.8px`）· **全表无 700+** ✅ | `weight 300` 展示字真的存在 · 正文 `0.16px` · 眉标 sentence case ✅ | 700 只用于 display/stat（`stat-display` 字距 **-1.5px 原值不减**）· **无 500 标题** ✅ |
| 渐变 | 0 处 ✅ | 2 处但都是**功能性斜纹**（"待定"段与量程槽），非氛围渐变 ⚠️ 属扩展 | 1 处功能性斜纹 ⚠️ 属扩展 |
| 唯一发现的偏离 | 发丝边框 1.24–1.36:1（参照自身规格） | **`.pnl-h .lg` 一处全大写加字距标签**违反"眉标须 sentence case" | `--rounded-md` 7px vs 参照 8px（已声明） |

### 一个跨三版的共同发现（值得你决策）

**这三份设计语言都靠"发丝线 + 表面明度差"承载层级，而不是投影**，因此它们的**组件边界对比度天然很低**：L1 发丝 1.24–1.36:1、L3 1.38–1.74:1、L2 `hairline #e0e0e0` 对白底约 1.3:1。这低于 WCAG 1.4.11 对"界面组件边界"要求的 3:1。三版都选择**忠于参照 + 如实标注**，没有偷偷加重。要合规就需要把交互控件的描边提到约 `#6e6e6e`（深色）/ `#767676`（浅色），会明显偏离这三套语言的面貌——**这是一个取舍，不是缺陷，需要你定**。

### 字体适配（离线约束下的共同问题）

三份参照点名的字体**本机都不存在**：`Linear Display/Text`、`IBM Plex *`、`Inter`、`SF Pro`、`Geist` 全部未安装，`Segoe UI Variable` 也没有（本机是 Win10）。三版统一落到 `"Segoe UI"` + `"Noto Sans SC"`（本机有 Thin/Light/DemiLight/Medium/Black 全字重）+ `"Cascadia Mono"`，并**保留各自的性格**：Linear 的负字距、Carbon 的 weight 300 展示字（用 `Segoe UI Light` 复现）、ClickHouse 的 700 重字与强负字距。

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
