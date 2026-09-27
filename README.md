# LLaMA 模型管理器

独立的 Electron 桌面应用，用于管理和启动 llama.cpp 本地模型服务。
**不依赖 DSH**，双击桌面快捷方式即可使用。

## 功能

- **服务卡片**：每个模型一张卡片，显示状态 / 角色 / 模型 / 端口 / 显存占用
- **三种服务类型**：llama 模板（GGUF 模型）、自定义命令、Compose 服务（docker compose 管理容器栈）
- **一键启停**：启动 / 停止 / 重启单个服务（Compose 走 `docker compose up -d / down / restart`）
- **预设组**：内置「OpenViking 组」（vlm+embedding+intent）和「聊天组」，可自定义
- **模型扫描**：自动扫描 `D:\LLM Model` 下所有 `*.gguf`，自动关联 mmproj
- **GPU 监控**：实时显存占用 + 阈值警告
- **日志查看器**：应用内实时查看每个服务的启动/运行日志
- **崩溃恢复**：服务异常退出自动退避重启 + 系统通知
- **托盘常驻**：关窗隐藏到托盘，服务继续运行
- **单实例**：重复双击唤起已有窗口

升级方向与目标见 [ROADMAP.md](ROADMAP.md)。

## 开发

```bash
pnpm install          # 安装依赖（Electron 二进制走 npmmirror 镜像）
pnpm run build        # 构建 main + preload + renderer
pnpm run build:main   # 仅主进程
pnpm run build:renderer # 仅渲染进程
```

冒烟测试（启动后 3 秒自动退出，打印 `LLAMA_SMOKE_OK`）：

```bash
$env:LLAMA_SMOKE='1'
& node_modules\electron\dist\electron.exe .
```

## 打包

```bash
pnpm run build
node_modules\.bin\electron-builder --projectDir . --win nsis
```

产物在 `release/`，安装器会自动创建桌面快捷方式「LLaMA 模型管理器」。

## 配置

- 配置：`%APPDATA%\LLaMA 模型管理器\services.json`（Electron userData，随 productName 命名）
- 日志：`%APPDATA%\LLaMA 模型管理器\logs\<service>.log`
- 模型目录：`D:\LLM Model\llama.cpp\models\`
- 运行时：`D:\LLM Model\llama.cpp\runtime\llama-server.exe`
- 源码：`D:\LLM Model\llama.cpp\source\`

## 默认服务

| 服务 | 模型 | 端口 | 自启 |
|---|---|---|---|
| vlm | Qwen2.5-VL-7B Q4_K_M + mmproj | 11435 | 关 |
| embedding | bge-m3 Q8_0 | 11436 | 关 |
| intent | ov_intent_analysis_sft Q8_0 | 11437 | 关 |
| chat-27b | Qwen3.8-27B Q4_K_XL | 8080 | 关 |
| ov-server | OpenViking python 服务 | 1933 | 关 |
| weknora | WeKnora 容器栈（E:\weknora） | 18080 | 关 |

> 所有服务默认手动启动（autostart=false），随应用启动由每张卡片开关控制。

> 27B 与三件套显存冲突（24GB 卡），启动前应用会显示显存警告，不强制阻止。
