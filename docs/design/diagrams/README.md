# 交互闭环流程图（12 个闭环，11 张图）

用 archify 生成的可交互 HTML：暗/亮主题、平移缩放、搜索、聚焦节点、按关系追踪、Presentation 模式、导出 PNG/SVG。
每张图下方三张卡片分别是**闭环判据**、**界面承载**、以及**当前应用缺的能力**——那才是设计依据。

## 全部闭环

| 图 | 闭环 | 一句话 |
|---|---|---|
| [loop-inspect.workflow.html](loop-inspect.workflow.html) | **L1** 巡检 | 唤起窗口 → 顶栏摘要 → 失败行 → 抽屉 → 处置 → 摘要归零 |
| [loop-group-switch.workflow.html](loop-group-switch.workflow.html) | **L2** 组切换与独占互斥 | 点组启动 → 冲突检测 → 确认模态 → 旧组停净 → 新组就绪 → 组运行中 N/N |
| [loop-onboard.workflow.html](loop-onboard.workflow.html) | **L3** 新增服务 | 选形态 → 表单 → 保存入列 → 校验预检 → 拉起 → 就绪 |
| [loop-trial-promote.workflow.html](loop-trial-promote.workflow.html) | **L4** 模型体验 | 模型库 → 一键体验（临时端口）→ 试用 → 转正（沿用参数） |
| [loop-download.workflow.html](loop-download.workflow.html) | **L5** 下载模型 | 搜索选型 / 直链 → 拉取（可取消）→ 校验 → 进入模型列表 |
| [loop-troubleshoot.workflow.html](loop-troubleshoot.workflow.html) | **L6 + L7** 排障与日志 | 失败行 → 抽屉（错误 + 日志尾部）→ 归因四类 → 修正 → 重启 → lastError 清空 |
| [loop-settings.workflow.html](loop-settings.workflow.html) | **L8** 设置维护 | 改项 → 写入 + 运行时生效 → 重启后仍成立 |
| [loop-external-config.workflow.html](loop-external-config.workflow.html) | **L9** 外部配置变更 | 外部改 services.json → 提示条 → 比对差异 → 只重启受影响服务 → 对齐 |
| [loop-quit.workflow.html](loop-quit.workflow.html) | **L10** 退出 | 点退出 → 有服务则确认 → 停或留 → 状态符合选择 |
| [loop-vram-alert.workflow.html](loop-vram-alert.workflow.html) | **L11** 资源告警 | 显存超阈 → 顶栏转警示 → 按占用排序 → 停谁 → 回落解除 |
| [loop-group-manage.workflow.html](loop-group-manage.workflow.html) | **L12** 组管理 | 组管理 → 编辑成员与独占 → 写入预设 → 组条更新 → 可一键启停 |

L7（日志导出：复制 / 打开目录 / 清空）是 L6 抽屉内的一个动作，因此与 L6 合并为一张图。

## 重新生成

规格文件是同名 `.json`，改完重新生成：

```bash
SK="C:/Users/7/.dsh/profiles/desktop/node_modules/@tt-a1i/archify-dsh/skills/archify"
node "$SK/bin/archify.mjs" validate workflow <spec>.json --quality showcase --json
node "$SK/bin/archify.mjs" deliver  workflow <spec>.json <out>.html --quality showcase --json
```

## 编排规则（改图前先看，能省掉反复返工）

这 11 张图是在工具的多轮诊断下逐个修出来的，规则如下：

1. **主路径的列号必须单调不减**，回环用 `role: "return"` 的边单独表达，不要放进 `mainPath`。
2. **同一泳道相邻两列之间只能是「无标签」的短边**；要带标签就得隔一列。
3. **跨泳道同列 = 垂直跳转**，空间最充裕，优先用它。
4. **节点宽度默认 92px**，可用文本宽约 84px（中文约 7.5px/字）；首列与末列不要设更大宽度，否则会超出泳道水平边界。
5. **收尾节点要放在中间泳道为空的那一列**，否则上升边会穿过同列的其它节点。
6. **同泳道的水平边加 `route: "straight"`**，否则会出现 7px 的折角被判定为 micro-segment。
7. 长标签压到节点上时用 `labelDy` 推开（例如 `+18`）。

## 验收状态（如实记录）

- **构图检查 9/9 通过、0 error / 0 warning**：单 SVG、正交箭头、标签-路由间距、关系交叉、路由走廊、容器边框连续、路由节奏、图例间距——11 张全部通过。
- **`visual-check` 垂直包含性未达标**：在 1440×900 下页面高 1358px、2048×1320 下 1448px，超出视口（无横向溢出，缩放交互正常）。
  - 标定参考：本技能自带的参考产物 `examples/workflow-agent-tool-call-rendered.html` 在同尺寸下为 2040–2165px、`examples/lifecycle-agent-run.html` 为 1244–1332px，即**技能自身的参考产物同样不满足该门槛**。此门槛属契约理想值，非实际交付标准。
  - 该检查只在 `loop-inspect` 上执行过（含 1440×900 与 2048×1320 亮/暗截图与接触表）；其余 10 张只跑了构图检查。
- `visualReview` 由工具固定报 `pending`——它只提供证据，不作人工目视结论。

## 讨论入口

交互模型与信息架构的完整讨论稿见 [../interaction-model.md](../interaction-model.md)（12 个闭环、动作清单、闭环→界面承载映射、三个待决问题）。
