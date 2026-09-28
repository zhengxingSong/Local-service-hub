# 结构预览

| 文件 | 用途 |
|---|---|
| [ui-preview.html](ui-preview.html) | **高精度可交互预览**（按 [ui-layout.md](../ui-layout.md) 的三页结构 + 浮层；数据取自本机真实配置与实时状态） |
| [ui-wireframe.html](ui-wireframe.html) | 线框版（102 个控件逐个带功能 / 可用条件 / 关联控件标注，用于核对规格完整性） |

## 高精度版怎么用

顶部三组开关覆盖全部面：

- **场景**：`真实状态`（默认，与此刻机器一致）· `排障演示` · `切换演示`
- **视图**：运行 / 配置 / 服务编辑 / 设置
- **浮层**：预检 / 危险确认 / 素材获取 / 探测 / 组编辑 / 服务抽屉
- 另有「模拟外部变更」与「标注模式」（标注模式下悬停控件显示功能 / 可用条件 / 关联控件）

**可走通的真实链路**：点「聊天组 → 启用」→ 弹出预检（占用族冲突 + 资源族差 4.1 GB）→ 点「停掉它」→ 模态关闭、场景切到切换演示、OpenViking 组进入「停止中 2/4」。这条链就是行为地图里的**链路 9（切换用途，事务化）**。

## 数据来源（全部真实）

| 数据 | 来源 |
|---|---|
| 8 个服务定义、端口、alias、模型路径、args | `%APPDATA%\服务中枢\services.json` |
| 显存估算（vlm 6448 / embedding 678 / intent 867 / chat-27b 19144 / reranker 423 MB） | `vram-cache.json`（应用自己的估算器写入） |
| 运行中服务与 PID（vlm 23500 / embedding 8740 / intent 21736 / ov-server 7852） | 端口探测 + 进程查询 |
| 显存 9.6 / 24 GB、内存 19.2 / 63.8 GB、磁盘 D 740 / 1024 GB | `nvidia-smi` / `Win32_OperatingSystem` / `Win32_LogicalDisk` |
| 模型文件清单与大小（9 个 GGUF / 57.7 GB） | 扫描 `D:\LLM Model\llama.cpp\models` |
| 日志内容与大小（ov-server 3.36 MB 最大） | `%APPDATA%\服务中枢\logs\*.log` |
| 预设组 `OpenViking 组` / `聊天组` | `services.json` 的 `presets` |

资源面的数字能对上账：`vlm 6448 + embedding 678 + intent 867 + ov-server 320 = 8313 MB`，加上非本应用管理的 `1310 MB`，正好等于 `nvidia-smi` 的 `9623 MB`。

**真实数据里顺带暴露的三件事**（预览里都如实显示）：

1. **57.7 GB 素材中有 3 个未被任何服务引用**（SenseNova-U1.5 18.58 GB、qwen2.5-vl f16 14.19 GB、mmproj-F16 0.86 GB）——前两个是大文件，值得决定是否保留。
2. **`mmproj-F16.gguf` 与 `mmproj-f16.gguf` 只差大小写**，是两个不同文件——重复素材，正是「删除前检查引用」要处理的场景。
3. **`reranker` 的模型路径含重复反斜杠**（`D:\\LLM Model\\...`），Windows 能解析，但属于手改配置留下的痕迹。清单里给它加了一个警告标记，用来说明「清单要能暴露定义本身的问题，而不是只在启动失败时才告诉你」。

## 真实状态与演示状态的边界

默认场景与机器一致：**OpenViking 组 4/4 可用**（4 个成员都在跑，启动于 06:54），其余 4 个用途未运行。

`排障演示` 与 `切换演示` 是**合成场景**，用于查看「部分可用」与「切换事务进行中」两种界面状态——真实配置里没有这两种状态可看。另外，真实的 `exclusivePresets` 是空数组（没有任何组标记独占），因此预检里的「独占冲突」要先把两个组标记为独占才会发生；预览按标记后的效果展示，以便看到仲裁界面。

## 维护约定

1. 可交互控件写三个属性：`data-fn`（功能）、`data-cond`（可用条件）、`data-rel`（关联控件的 `data-id` 列表）。**可用条件是一等内容**，不许留空或写「未声明」。
2. 关联目标写在 `data-id` 上即可，脚本会同时按 `id` 与 `data-id` 查找。
3. `<table>` / `<input>` / `<select>` 上可以挂 `data-fn`（悬停高亮照常生效），但不能注入标注角标——它们不能承载子元素。
4. 改完做一次自查：

```powershell
# 静态检查：标签配平 / 重复 id / 悬空 data-rel / 外链 / 脚本语法
node <check-script>.mjs ui-preview.html

# 交互探针：注入 <script>，把结果写进 <pre id="probeout">，再 --dump-dom 取回
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
  --virtual-time-budget=6000 --dump-dom "file:///.../hifi-probe.html"
```

**两个坑**：`--dump-dom` 不输出 console（必须把结果写进 DOM 再取）；注入脚本**不要用 PowerShell 的 `-replace`**（它的正则替换会吃掉脚本内容，改用 `String.Replace`）。
