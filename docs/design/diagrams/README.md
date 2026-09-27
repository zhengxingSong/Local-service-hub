# 交互闭环流程图

用 [archify](../../../../../.agents/skills) 生成的可交互 HTML：暗/亮主题、平移缩放、搜索、聚焦、按关系追踪、Presentation 模式、导出 PNG/SVG。

## 已出图

| 图 | 覆盖闭环 | 一句话 |
|---|---|---|
| [loop-inspect.workflow.html](loop-inspect.workflow.html) | **L1** 巡检 | 唤起窗口 → 顶栏摘要 → 失败行 → 抽屉 → 处置 → 摘要归零 |
| [loop-group-switch.workflow.html](loop-group-switch.workflow.html) | **L2** 组切换与独占互斥 | 点组启动 → 冲突检测 → 确认模态 → 旧组停净 → 新组就绪 → 组运行中 N/N |
| [loop-troubleshoot.workflow.html](loop-troubleshoot.workflow.html) | **L6 + L7** 排障与日志 | 失败行 → 抽屉（错误 + 日志尾部）→ 归因 → 修正 → 重启 → lastError 清空 |
| [loop-onboard.workflow.html](loop-onboard.workflow.html) | **L3** 新增服务 | 选形态 → 表单 → 保存入列 → 校验预检 → 拉起 → 就绪 |

每张图的规格文件是同名 `.json`，改完重新生成：

```bash
SK="C:/Users/7/.dsh/profiles/desktop/node_modules/@tt-a1i/archify-dsh/skills/archify"
node "$SK/bin/archify.mjs" validate workflow <spec>.json --quality showcase --json
node "$SK/bin/archify.mjs" deliver  workflow <spec>.json <out>.html --quality showcase --json
```

## 尚未出图

| 闭环 | 内容 |
|---|---|
| L4 体验→转正 | 模型库 → 一键体验（临时端口）→ 试用 → 转正（沿用参数）/ 放弃 |
| L5 下载模型 | 按名称搜索选型 / 直链（可选 SHA256）→ 进度可取消 → 落盘校验 → 创建服务或体验 |
| L8 设置维护 | 改项 → 保存 → 即时生效（运行时参数、登录自启写注册表） |
| L9 外部配置变更 | 外部改 services.json → 提示条 → 应用 → 只重启受影响且运行中的服务 |
| L10 退出 | 有服务在跑 → 列出并问是否同停 → 退出 |
| L11 资源告警 | 显存超阈 → 顶栏转警示 → 看谁占最多 → 停 → 回落 → 告警消失 |
| L12 组管理 | 新建 / 改名 / 增删成员 / 标记独占 → 保存 → 组条更新 |

## 验收状态（如实记录）

- **构图检查 9/9 通过，0 error / 0 warning**（`single_svg`、`finite_svg`、`orthogonal_arrows`、`label_route_clearance`、`relationship_crossings`、`relationship_corridors`、`container_border_runs`、`route_rhythm`、`legend_clearance`）
- **`visual-check` 垂直包含性未达标**：1440×900 下页面高 1358px、2048×1320 下 1448px，大于视口。无横向溢出，交互与缩放正常。
  - 标定参考：本技能自带的参考产物 `examples/workflow-agent-tool-call-rendered.html` 在同尺寸下为 2040–2165px、`examples/lifecycle-agent-run.html` 为 1244–1332px，即**技能自身的参考产物同样不满足该门槛**。此门槛属契约理想值，非实际交付标准。
- 截图证据：`loop-inspect.workflow.visual-check.*.png`（1440×900 与 2048×1320，亮/暗各一）与接触表 `loop-inspect.workflow.visual-check.html`。`visualReview` 由工具固定报 `pending`——它只提供证据，不作人工目视结论。

## 讨论入口

交互模型与信息架构的完整讨论稿见 [../interaction-model.md](../interaction-model.md)（12 个闭环、动作清单、闭环→界面承载映射、待决问题）。
