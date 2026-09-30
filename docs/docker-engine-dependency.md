# 为什么每次都要先打开 Docker Desktop

> 诊断日期：2026-10-01　诊断方式：只读探测（未启动 WSL 发行版、未改 Docker 设置、未改注册表、未改产品代码）
> 问题：启动 docker 服务（尤其是本产品管理的 Compose 服务）之前，必须手动打开 Docker Desktop。

## 一、结论摘要

可以不用管 Docker Desktop 的**窗口**，有三条路，代价递增：

| 路 | 做什么 | 能解决 | 代价 / 还缺什么 |
|---|---|---|---|
| **1** | 用 CLI 起引擎（`docker desktop start`）+ 打开登录自启 | 你不再需要打开窗口 | Docker Desktop 仍装着（内存 / 后台进程 / 许可） |
| **2** | 让「服务中枢」探测引擎并代你启动 | 界面上按一下就行，彻底不用关心引擎 | 需要改产品代码并重新打包安装 |
| **3** | 在 WSL2 里装原生 Docker Engine，卸掉 Desktop | 彻底没有 Desktop | **两处拦路石（见第五节）**，且需要给产品加自定义 docker 命令支持 |

**一句话**：文章的方案本身没错，但它假设你是"在 WSL 终端里用 docker"；**本产品跑在 Windows 上、调用的是 Windows 版 `docker.exe`，只认 Windows 命名管道**——照文章装完，产品仍然用不了。

## 二、实测环境

| 项 | 实测值 | 怎么测的 |
|---|---|---|
| docker CLI | `C:\Program Files\Docker\Docker\resources\bin\docker.exe`，客户端 28.0.4 | `Get-Command docker` / `docker version` |
| 当前上下文 | `desktop-linux *` → `npipe:////./pipe/dockerDesktopLinuxEngine` | `docker context ls` |
| 引擎状态 | **未运行**：`open //./pipe/dockerDesktopLinuxEngine: 找不到指定的文件` | `docker info` |
| `docker desktop` 插件 | **已装 v0.1.6**，帮助里写着 "You can start Docker Desktop by running `docker desktop start`" | `docker desktop --help` |
| 后端服务 | `com.docker.service`：**Stopped / Manual** | `Get-Service *docker*` |
| 登录自启 | `settings-store.json` → `AutoStart = false`；注册表 Run 项里却有 `Docker Desktop.exe -Autostart` | 读 `%APPDATA%\Docker\settings-store.json` + `HKCU:\...\Run` |
| 代理 | `ProxyHTTPMode=manual`，HTTP/HTTPS 走 `http://127.0.0.1:7897`，排除表含 `registry.npmmirror.com` 等 | 同上 |
| WSL | 发行版：`Ubuntu-22.04`（默认）、`Ubuntu`、`docker-desktop`、`docker-desktop-data`；**全部 Stopped**；版本 2；无 `.wslconfig` | `wsl -l -v` |
| 产品的调用方式 | `findDocker()` **写死** `...\Docker\resources\bin\docker.exe`（找不到才回落 `docker`）；命令为 `compose [-f 文件] [--profile x] up -d --remove-orphans` / `down` / `restart` / `logs` | 读 `src/main/service-manager.ts:186-202, 367, 517, 563, 696` |
| 产品是否识别"引擎未运行" | **否**。没有针对引擎不可达的分支，只会把 pipe 失败当成"服务启动失败" | 全文件检索 `pipe/engine/daemon/Cannot connect` 无命中 |

## 三、根因

Docker 在这里是**两段式**：

```
Windows 的 docker.exe ──(命名管道 \\.\pipe\dockerDesktopLinuxEngine)──> 引擎（Desktop 起的 Linux VM）
```

`docker` 命令只是客户端；**引擎是一个需要被启动的独立进程**，而当前**没有任何东西在登录时或按需启动它**（`com.docker.service` 是 Stopped/Manual，`AutoStart=false`）。

所以你唯一知道的启动方式就是打开 Desktop 的窗口——**那其实只是"启动引擎"的一种副作用**，不是必须的。

## 四、三条路的评估

### 路 1：用 CLI 起引擎（最小改动，今天可用）

```powershell
docker desktop start      # 起引擎
docker desktop status     # 查状态
```

外加打开 Desktop 的登录自启（Settings → General → "Start Docker Desktop when you sign in"），引擎就会常驻，窗口不必出现。

**未验证项**：我**没有运行** `docker desktop start`（按你"只诊断"的要求）。因此"它是否完全不弹窗、只进托盘"**是文档说法，不是我实测的结论**。这一点值得你在方便时亲自试一次。

### 路 2：让「服务中枢」代你管引擎（与产品前提最一致）

产品现在把"引擎没起"和"服务起不来"混为一谈。可以按它既有的设计改：

- 启动 Compose 服务前先探引擎（管道是否存在 / `docker desktop status`）；
- 没起就 `docker desktop start`，**等管道出现**（轮询 + 超时）再执行 `compose up`；
- 或者做成**预检①环境族的一项**：「Docker 引擎未运行」+ 动作「启动引擎」——这正是产品里四族判定的用法。

代价：改代码、补单测、重打包安装（本仓库的标准流程）。

### 路 3：WSL2 原生 Engine（文章方案）

适合"在 WSL 终端里用 docker"，但**对本产品有两个真实的拦路石**（下一节）。

## 五、路 3 的两处拦路石（文章没提）

### 石一：Windows 的 `docker.exe` 看不见 WSL 里的引擎

- WSL 里的 dockerd 监听的是 **Unix socket**（`/var/run/docker.sock`）；
- Windows 版 `docker.exe` 只认 **Windows 命名管道**。

所以照文章装完，`docker` 在 WSL 里能用，**但本产品（spawn 的是 Windows 版 docker.exe）仍然用不了**。要对上必须三选一：

| 桥接方式 | 说明 | 主要问题 |
|---|---|---|
| 产品改走 WSL：`wsl -d Ubuntu docker compose …` | 最贴合，因为容器本来就跑在 WSL 里 | **现在不行**：`composeBaseArgs()` 只生成 `['compose', …]`，拼出来是 `wsl.exe compose …`（缺 `-d <发行版> docker`）。需要给产品加「自定义 docker 命令 / 前缀」配置 |
| 把 dockerd 暴露到 TCP：`-H tcp://0.0.0.0:2375` + `DOCKER_HOST=tcp://localhost:2375` | 不改产品代码 | **本机明文无认证端口**；共用机器上是真实的安全取舍 |
| 命名管道↔unix socket 中继（npiperelay / socat） | 不改产品代码 | 活动件最多，重启/睡眠后最容易坏 |

### 石二：WSL 会在空闲时整个关掉

实测四个发行版**全部是 Stopped**。WSL 发行版在没有进程时会自动关闭，所以"装原生引擎"**并没有消掉"得有人把引擎拉起来"这件事**，只是从 Desktop 挪到了别处。你仍然需要一套自启机制，例如：

- 登录时由任务计划程序执行 `wsl -d Ubuntu-22.04 -u root service docker start`；或
- 在 WSL 里开 systemd（`/etc/wsl.conf` 加 `[boot] systemd=true`）——但**发行版没启动时 systemd 也不在**，仍需要一个"把发行版拉起来"的触发者。

## 六、待确认项（需要一次启动才能测，本次刻意没做）

1. **`AutoStart=false` 与注册表 Run 项并存**：可能是 GUI 里已关闭但 Run 项是残留，也可能键名不同导致我读错了字段。**确认方法**：打开 Desktop → Settings → General，看那一项的勾选状态。
2. **`Ubuntu-22.04` 里的 `docker` 现在是谁**：如果 Desktop 的 WSL 集成是开着的，那里面的 `docker` 通常是 Desktop 注入的客户端（不是原生引擎）。**确认方法**：`wsl -d Ubuntu-22.04 -- sh -c 'which docker; docker context ls; ls -l /var/run/docker.sock'`（会启动该发行版）。
3. **`docker desktop start` 是否真的不弹窗**（见路 1 的未验证项）。
4. **`docker desktop engine ls`** 能列出可切换的引擎模式（Windows 专有命令），但需要 Desktop 在后端运行才能查。

## 七、决策判据

- 如果你的痛点只是"**不想手动开窗**" → 走路 1，风险几乎为零。
- 如果希望"**在本产品里按一下就能起，不再关心引擎**" → 走路 2。
- 只有当你要**卸掉 Docker Desktop 本身**（省内存、许可、后台进程）时，才值得走路 3；届时需要同时解决"产品如何驱动 WSL 里的引擎"（石一）与"谁在登录时把引擎拉起来"（石二）。

## 八、本次未做的事（明示）

- 未运行 `docker desktop start`（或其他任何会改状态的 docker 命令）
- 未启动任何 WSL 发行版
- 未修改 `settings-store.json`、注册表、`.wslconfig`
- 未改动产品代码
