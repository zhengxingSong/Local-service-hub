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

界面按三个态组织：**运行**（默认）/ **配置** / **设置**，外加一个二级页 **服务编辑**。

### 运行态

- **用途卡**：一张卡 = 一个用途（一个预设组，或一个未分组服务）。**可用性是第一视觉**——左侧状态条 + 「可用 / 部分可用 n/m / 未运行」，成员按启动顺序可展开，失败的成员就地给可点的处置入口；某个成员被其它正在运行的用途共用时会显式提示，停组前就知道会影响谁
- **资源账本**：不是监控仪表盘，而是预检的可视化——显存余量、**还能启动什么**（可启动 / 差多少容量）、占用者明细（实测优先、推算次之、其余按差值归「其它进程」，每项都标来源）
- **内联变更条**：`services.json` 被应用外修改时出现，给出应用 / 忽略

### 启动前的预检决策面

启动任何服务或用途前先过四族判定，顺序固定为**从最便宜可修到最贵可修**：

| 族 | 判定内容 |
|---|---|
| ① 依赖 | 组内悬空成员（配置已删、组里还留着）阻断；顺序即依赖，并如实说明"按顺序发起但不等前一个就绪" |
| ② 环境 | 运行时路径 / 模型 / 命令 / Compose 目录填没填；并声明这里**不校验文件是否真的存在** |
| ③ 占用 | 端口被运行中的别的服务占用；独占组与另一个正在运行的独占组互斥 |
| ④ 资源 | 算出差额，给「停掉占用者释放 X」与「降需（调小 ctx）」两条出口 |

每族都标注**来源可信度**（算出来的 / 读出来的 / 你声明的 / 不可用）。推算不完整时**不算通过**——让人显式接受，而不是悄悄放行。出口三条：就地修 / 重新预检 / 仍然启动（并写明"强制启动不会让显存变多，只会让进程在加载时失败"）。

### 处置抽屉（为什么起不来）

固定顺序 **状态 → 归因 → 运行记录 → 日志**：

- **归因**：只从主进程真实提供的字段（state / lastError / returncode / 起止时间 / 重启次数 / 端口占用）判断问题出在哪一段；用**运行时长**把「没起来就退」（< 3 秒，多为路径/参数/运行库）与「跑着崩了」（≥ 3 秒，多为运行期负载/显存碎片）分开。每条结论都带依据与**置信度**，证据不足时降置信度而**不是硬猜**
- **运行记录**：每次「启动 → 结束」的起止、就绪耗时、退出码、显存峰值；主进程持久化，保留最近 200 条。就绪耗时能看出模型是不是越起越慢
- **修正动作**：能就地做的（重试 / 停止 / 停占用者 / 开日志目录）直接做，要改配置的把人送到对应页面

### 配置态

三个页签：

- **服务清单**：表格化的定义视角——名称 / 形态 / 暴露 / 归属组（一个服务可属多个组）/ 状态位 / 行内动作（编辑 / 复制 / 日志 / 删除）。「已启用」与「运行中」是两个不同的位，分开显示
- **预设组**：组卡的成员**顺序即启动顺序**，可上移下移；独占标记；未分组服务单独成区
- **素材**：模型文件的大小、被哪些服务引用、未被引用、含 mmproj、同名重复提示

### 服务编辑（二级页，六段）

① 形态 ② 准备 ③ 启动 ④ 暴露与就绪 ⑤ 需求 ⑥ 策略，左栏是段导航 + **常驻校验摘要**（问题项可点并跳到该段；阻断级才拦保存）。⑤ 需求把四族条件摆出来并标注来源；**② 准备当前版本尚未支持**（如实标注，不假装有）。

### 探测（新增服务）

新增服务先探测：选目录 → 判断它是**模型目录 / Docker Compose 项目 / 源代码项目**，依据逐条列出（找到了哪个标志文件、几个 gguf）→「用这个形态继续」预填服务编辑。模型目录会自动配上同目录的 mmproj（多模态最容易漏的一步）；**认不出来就说认不出来**，不猜形态；源码项目**不猜可执行文件路径**（不同机器上 python/node 未必在 PATH 里）。

### 设置

三段：能力（llama-server 路径 / 扫描根 / 下载目录）、运行（崩溃重启上限 / 显存警告阈值 / 登录自启）、**配置快照**（保存前自动生成、保留最近 10 份；恢复前会再存一份当前配置，所以**恢复本身可逆**）。

### 全局

- **Toast**：成功 4 秒自动消失，**失败常驻**（4 秒后自己消失的错误提示等于没提示），上限 4 条
- **危险确认**：六种危险动作（删服务 / 解散组 / 强制停止 / 回滚快照 / 丢弃体验 / 退出）各有专属文案，每种都说明**会发生什么**与**不会发生什么**
- **一键启停**：启动、停止、重启单个服务或整个用途；Compose 走 `docker compose up -d / down / restart`
- **日志**：按服务落盘、超过 5MB 自动轮转、应用内只看尾部（不整文件读入）
- **崩溃恢复**：服务异常退出按指数退避重启，超过上限转为失败态
- **GPU 监控**：nvidia-smi 采样显存占用与阈值警告（无 NVIDIA 驱动时自动退避，不反复拉起进程）
- **托盘常驻**：关窗隐藏到托盘，服务继续运行；退出时询问是否同时停止服务
- **单实例**：重复双击唤起已有窗口
- **配置热加载**：外部修改 `services.json` 后提示是否应用，并只重启受影响的服务

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
