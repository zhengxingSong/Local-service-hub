# LLaMA 模型管理器 — 开发计划（历史记录）

> **历史文档**：本文件记录 0.1.0–0.3.1 时期以「LLaMA 模型管理器」为定位的开发计划与实现记录，
> 其中的目录结构、默认服务与配置路径可能已过时，请勿据此行事。
> 当前定位与目标见 [ROADMAP.md](ROADMAP.md)，使用方式见 [README.md](README.md)。
> 相关的用户数据已迁移到 `%APPDATA%\服务中枢`。

独立 Electron 桌面应用（非 DSH 插件），管理并启动 llama.cpp 模型服务。
工程目录：`D:\LLM Model\llama.cpp\desktop\`

## 已确认决策

| 项 | 结论 |
|---|---|
| 技术栈 | Electron + Vite + React + TypeScript |
| 范围 | 只管理 llama-server 进程 |
| 托盘 | 常驻；关窗隐藏；退出时询问（默认停服务） |
| 自启动 | 每服务独立开关 + 全局随 Windows 登录 |
| 预设组 | OpenViking 组 / 聊天组 / 可自定义 |
| 语言 | 简体中文（架构留 zh/en） |
| 运行时 | 迁到 `D:\LLM Model\llama.cpp\runtime\` |
| 源码 | 迁到 `D:\LLM Model\llama.cpp\source\` |
| 打包 | electron-builder + NSIS，安装自动建桌面快捷方式 |
| 应用名 | LLaMA 模型管理器（标识 llama-manager） |
| 单实例 | 强制单实例 |
| 崩溃通知 | 系统通知 + 界面提示 |
| 默认服务 | vlm/embedding/intent(自启) + chat-27b(手动) |
| 配置/日志 | `~/.config/llama-manager/` |
| 模型扫描 | `D:\LLM Model` 下 *.gguf |

## 目录结构

```
desktop\
├── package.json
├── electron-builder.yml
├── vite.config.ts
├── tsconfig.json
├── index.html
├── resources\icon.ico
├── scripts\
│   ├── prepare.mjs        # 构建前拷贝 runtime 路径清单等
│   └── shortcut-check.mjs # 打包后校验快捷方式（安装器负责，脚本仅辅助）
└── src\
    ├── main\              # Electron 主进程
    │   ├── index.ts       # 入口：窗口/托盘/单实例/生命周期
    │   ├── config.ts      # 配置存储 ~/.config/llama-manager/services.json
    │   ├── service-manager.ts  # ManagedService 进程监督（迁移自 dsh-plugin-llama）
    │   ├── model-scanner.ts    # GGUF 扫描 + mmproj 关联
    │   ├── gpu-monitor.ts      # nvidia-smi 显存
    │   ├── presets.ts          # 预设组定义与解析
    │   ├── logger.ts           # 日志落盘（轮转 5MB）
    │   └── ipc.ts              # IPC handler 注册
    ├── preload\
    │   └── index.ts       # contextBridge 暴露安全 API
    └── renderer\          # React UI
        ├── main.tsx
        ├── App.tsx
        ├── styles.css
        └── components\
            ├── ServiceCard.tsx
            ├── PresetBar.tsx
            ├── GpuBar.tsx
            ├── ServiceEditor.tsx
            ├── LogViewer.tsx
            ├── SettingsPanel.tsx
            └── ConfirmDialog.tsx
```

## 里程碑

### M0 — 目录整理 + 工程脚手架
1. 确认 `D:\LLM Model\llama.cpp` 现有布局，把 `desktop` 目录作为工程根
2. 迁移 runtime：`D:\LLM Model\Qwen-3.8\llama.cpp\` 下的 exe/dll/bat → `D:\LLM Model\llama.cpp\runtime\`
   - 保留 turboquant 单独子目录（不同构建）
   - 记录 b10502 为默认 runtime
3. 迁移 source：`D:\deepseek\llama\src\llama.cpp-master` → `D:\LLM Model\llama.cpp\source\`
4. 脚手架：package.json / vite / ts / electron 最小窗口跑通

### M1 — 主进程核心
1. config.ts：services.json 读写 + 默认四服务预置
2. service-manager.ts：spawn/taskkill/退避重启/三竞态（迁移自插件并验证）
3. model-scanner.ts：递归扫 *.gguf + mmproj 兄弟探测 + 缓存
4. gpu-monitor.ts：nvidia-smi 采样缓存
5. logger.ts：按服务落盘日志（5MB 轮转）
6. presets.ts：OpenViking/聊天组 + 自定义组持久化
7. ipc.ts：status/config/models/start/stop/restart/logs/presets 全通道
8. 托盘 + 单实例 + 退出询问

### M2 — 渲染 UI
1. App.tsx 布局：GPU 顶栏 + 预设组条 + 服务卡片网格
2. ServiceCard：状态点/角色/模型/端口/alias/自启开关/启停/编辑/删除
3. ServiceEditor：模型下拉（扫描+手输）/mmproj/alias/端口/参数/自启/启用
4. PresetBar：OpenViking 组 / 聊天组 / 自定义组 一键启停
5. LogViewer：实时日志（轮询或流式）+ 过滤/清空
6. SettingsPanel：全局设置（llama-server 路径/扫描根/自启/显存警告阈值）
7. 中文 locale（zh/en 结构留位）

### M3 — 打包与验证
1. electron-builder NSIS 配置（应用名/图标/桌面快捷方式）
2. 打包生成安装器并安装验证
3. 端到端验收：双击启动 → 三件套自启 → 27B 手动 → 托盘 → 退出询问 → 日志查看 → 预设组一键
4. 更新 MODEL-MANIFEST 或补录 runtime/source 迁移记录

## 验收标准（M3 结束后）
1. 桌面快捷方式双击打开应用
2. vlm/embedding/intent 随应用启动自动拉起（自启开关）
3. 27B 手动启停，显存冲突仅警告
4. 托盘常驻，退出询问默认停服务
5. 崩溃自动重启 + 系统通知
6. 应用内日志可见
7. 预设组一键启停正确
8. 单实例：二次双击唤起已有窗口

## 已实现扩展（后续阶段）

- **通用命令服务**（Stage A）：`command/cwd/env` 字段，直接 spawn 任意可执行文件（如 OpenViking python 服务）。
- **Compose 服务**（Stage A2）：`composeDir/composeFile/composeProfiles` 字段，经 `docker compose up -d / down / restart / logs` 管理容器栈；
  容器由 Docker 守护，运行状态按 desired state 判定，操作经每服务串行链防并发；
  日志查看走 `docker compose logs`，docker 不可用时回退本地日志。
- **WeKnora**：已部署于 `E:\weknora`（git clone main 分支），`.env` 端口避让为前端 18080 / 后端 18081（避开 chat-27b 的 8080）；
  管理器已登记 `weknora` Compose 服务（composeDir=`E:\weknora`，状态检测端口 18080，autostart=false）。
  本机 Docker Hub 直连被阻断，镜像经 `docker.1ms.run` 拉取后 retag 为官方 tag。

## 风险与对策
- 端口被残留进程占用：启动前检测，报错提示不自动杀
- 托盘退出后服务残留：退出询问默认停止，用户可选保持
- 安装器需要管理员写 Program Files：改 per-user 安装目录（NSIS oneClick perMachine=false）
- b10502 对部分新模型架构不支持：runtime 路径可配置，turboquant 作为备用
