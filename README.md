# 服务中枢 ServiceHub

本机服务、进程与容器的统一管理器（Electron 桌面应用）。**不依赖 DSH**，双击桌面快捷方式即可使用。

## 定位

服务中枢管理本机需要长期运行、需要按需启停的各类服务，不限于某一种运行时：

| 服务形态 | 适用对象 | 必需字段 |
|---|---|---|
| `llama` | llama.cpp / Ollama / vLLM 等 GGUF 模型服务 | 模型路径 + llama-server 路径 |
| `command` | 任意可执行文件（Python 服务、脚本、自研程序） | `command`，可选 `cwd` / `env` / `args` |
| `compose` | Docker Compose 容器栈 | `composeDir`，可选 `composeFile` / `composeProfiles` |

llama 相关能力（模型扫描、一键体验、显存估算、GGUF 下载器）只是**可选面板**：只有配置了 llama-server 路径或扫描根目录后才会出现在界面上。

## 功能

- **服务卡片**：状态 / 类型 / 角色 / 模型或命令 / 端口 / 就绪判定 / 显存 / 重启次数
- **一键启停**：启动、停止、重启单个服务；Compose 走 `docker compose up -d / down / restart`
- **就绪判定**：区分「启动中」与「真正可用」，四种判定方式可逐服务配置
- **预设组**：把多个服务编成一组一起启停，可标记为「独占运行」，启动时提示停止其他组
- **日志**：按服务落盘、超过 5MB 自动轮转、应用内只看尾部（不整文件读入）
- **崩溃恢复**：服务异常退出按指数退避重启，超过上限转为失败态
- **GPU 监控**：nvidia-smi 采样显存占用与阈值警告（无 NVIDIA 驱动时自动退避，不反复拉起进程）
- **托盘常驻**：关窗隐藏到托盘，服务继续运行；退出时询问是否同时停止服务
- **单实例**：重复双击唤起已有窗口
- **配置热加载**：外部修改 `services.json` 后提示是否应用并只重启受影响的服务

## 就绪判定

服务卡片显示「就绪中…」还是「运行中」由就绪判定决定，未显式配置时按形态取默认值（llama → 模型列表，其余 → 端口）。

| 类型 | 行为 |
|---|---|
| `none` | 不检查，进程在即为运行中 |
| `tcp` | 端口可连接即就绪（默认用于 command / compose） |
| `http` | 请求 `path`，可校验 `expectStatus` 与 `expectBody`（支持 `{{alias}}` `{{model}}` `{{port}}` 占位） |
| `openai-models` | 解析 OpenAI 兼容的 `/v1/models`，校验指定 alias 已加载（默认用于 llama，llama.cpp / Ollama / vLLM / LM Studio 通用） |

端口被占用时，只有能识别实例身份的判定（`openai-models` / `http`）允许「接管」已有实例；纯 `tcp` 判定无法确认身份，一律按端口冲突报错，避免把无关进程当成自己的服务。

## 快速开始（clone → 跑起来 → 打包）

前置：Windows、Node ≥ 22、pnpm。运行时依赖为空（`lucide-react` 等只在构建期使用）。

```bash
git clone https://github.com/zhengxingSong/Local-service-hub.git
cd Local-service-hub
pnpm install          # Electron 二进制走 .npmrc 里固定的 npmmirror 镜像（直连 GitHub 会失败）
pnpm start            # 构建 main + preload + renderer，然后启动应用
```

只改界面时不必反复重启 Electron：

```bash
pnpm run dev:renderer    # Vite 开发服务器，渲染层热更新
pnpm run typecheck       # tsc --noEmit
pnpm test                # vitest
pnpm run build           # 只构建，不启动
```

### 打包，以及「为什么改了代码却看不到变化」

```bash
pnpm run dist            # 构建 + electron-builder
# 产物：release\服务中枢-Setup-<version>.exe（版本号取 package.json 的 version）
```

**打包不等于生效。** 源码在仓库里，而桌面快捷方式指向的是**已安装副本**
`%LOCALAPPDATA%\Programs\service-hub`，代码封在 `resources\app.asar` 里。
改完代码必须**重新打包并安装**，否则双击快捷方式启动的仍是旧那一份——这是本项目最容易踩的坑。

判断已安装副本是新是旧（把 `purpose-avail` 换成任意只有新版本才有的类名或字符串）：

```powershell
$asar = "$env:LOCALAPPDATA\Programs\service-hub\resources\app.asar"
[Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($asar)).Contains('purpose-avail')
# False = 已安装的是旧版本，需要重装
```

安装前需**退出正在运行的应用**（安装器要替换 exe 与 app.asar）。安装器是 per-user、非一键式，
会创建桌面与开始菜单快捷方式。静默安装：`.\release\服务中枢-Setup-<version>.exe /S`。

### 验证真实界面（渲染探针）

这个仓库的界面验证不靠"看截图"，而是把**构建产物**渲染出来做 DOM 断言 + 像素核对
（模板里 87 条断言，实测 86 通过；覆盖运行态/配置态/服务编辑/设置/预检/抽屉/确认面/探测/组编辑）：

```powershell
.\scripts\shot-renderer.ps1 -Probe
```

它给内置 API 打桩 → 用本机 HTTP 提供构建产物 → 截图 → 断言结构与 Carbon 不变式 → 自清临时文件。
脚本会自动探测 Python 与 Chrome（也可用 `$env:DSH_PYTHON` / `$env:DSH_CHROME` 指定）。

> `file://` 下 Chrome 会因 CORS 拒绝加载 `<script type="module">`，页面会是纯白——
> Electron 允许 `file://`，浏览器不允许，所以这个脚本必须走本机 HTTP。

## 开发

```bash
pnpm install             # 依赖（Electron 二进制走 npmmirror 镜像）
pnpm run typecheck       # tsc --noEmit
pnpm test                # vitest（143 项单元测试，不需要 Electron 与网络）
pnpm run build           # 构建 main + preload + renderer
pnpm run build:main      # 仅主进程（并把托盘图标复制进 dist）
pnpm run dev:renderer    # 仅渲染层 Vite 开发服务器
```

### 冒烟测试

启动后 3 秒自动退出并打印 `SERVICE_HUB_SMOKE_OK`。用 `--user-data-dir` 指向临时目录，
即可在**不影响正在运行的服务与真实配置**的前提下验证主进程能否完整启动：

```powershell
$env:SERVICE_HUB_SMOKE = '1'
& node_modules\electron\dist\electron.exe . "--user-data-dir=$env:TEMP\service-hub-smoke"
```

> **注意**：如果环境里存在 `ELECTRON_RUN_AS_NODE=1`（部分 Agent/IDE 宿主会注入），Electron 会退化成纯 Node，
> 表现为 `Cannot find module 'electron'` 或 `cjsPreparseModuleExports` 崩溃。此时需先清除该变量再启动。

## 打包

```bash
pnpm run build
node_modules\.bin\electron-builder --projectDir . --win nsis
```

产物在 `release/`，安装器会创建桌面快捷方式「服务中枢」。
运行时依赖为空（`lucide-react` 等只在构建期使用），因此 `app.asar` 约 0.3MB，只有应用自身代码。

## 配置

- 配置：`%APPDATA%\服务中枢\services.json`
- 日志：`%APPDATA%\服务中枢\logs\<service>.log`（超过 5MB 轮转为 `<service>.log.1`）
- 显存缓存：`%APPDATA%\服务中枢\vram-cache.json`
- 模型下载目录：设置里的「模型下载目录」，留空时取 `扫描根目录\llama.cpp\models`

首次以「服务中枢」启动时，如果新目录还没有 `services.json`，会自动从旧版
`%APPDATA%\LLaMA 模型管理器` 迁移 `services.json`（含 `.bak-*` 备份）、`vram-cache.json` 与 `logs/`。
Chromium 自有缓存不迁移。同时会清理旧版遗留的登录自启项（仅在确认其指向旧安装目录时删除）。

## 配置字段速查

```jsonc
{
  "llamaServerPath": "D:\\LLM Model\\llama.cpp\\runtime\\llama-server.exe",
  "scanRoots": ["D:\\LLM Model"],
  "modelsRoot": "",
  "showModelPanel": true,
  "services": {
    "ov-server": {
      "label": "OpenViking 服务",
      "role": "ov",
      "kind": "command",
      "command": "D:\\Python\\Python312\\python.exe",
      "args": ["D:\\deepseek\\ov-data\\run-server.py", "--config", "D:\\deepseek\\ov-data\\ov.conf"],
      "cwd": "D:\\deepseek\\ov-data",
      "env": { "PYTHONUNBUFFERED": "1" },
      "port": 1933,
      "healthCheck": { "type": "http", "path": "/healthz", "expectStatus": 200 },
      "autostart": false,
      "enabled": true
    }
  },
  "presets": { "OpenViking 组": ["vlm", "embedding", "intent", "ov-server"] },
  "exclusivePresets": []
}
```

服务与预设组的存在性以该文件为准：删除某个服务后重启不会复活。
文件被外部修改时会提示「应用」，应用后只重启参数确实变化且正在运行的服务。
