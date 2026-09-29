import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigStore, type AppConfig, type ServiceConfig } from './config';
import { removeLegacyLoginItems } from './legacy-login-item';
import { ModelDownloader } from './model-downloader';
import { scanModels } from './model-scanner';
import { sampleVram } from './gpu-monitor';
import { ServiceManager } from './service-manager';
import { migrateUserData } from './user-data-migration';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_TITLE = '服务中枢';
/** 旧版本 userData 目录名（旧 productName），用于一次性迁移 */
const LEGACY_PRODUCT_NAMES = ['LLaMA 模型管理器'];

// 迁移必须早于任何读取 userData 的构造：目录名随 productName 变化。
// 仅在默认 userData 位置执行；显式 --user-data-dir 时不动用户数据。
const userDataDir = app.getPath('userData');
const isDefaultUserDataDir = basename(userDataDir) === app.getName();
const migration = isDefaultUserDataDir
  ? migrateUserData({ userDataDir, appDataDir: app.getPath('appData'), legacyNames: LEGACY_PRODUCT_NAMES })
  : { migrated: false, from: null as string | null, copied: [] as string[] };

const configStore = new ConfigStore(join(userDataDir, 'services.json'));
let config: AppConfig = configStore.load();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let serviceManager: ServiceManager | null = null;
const downloader = new ModelDownloader();
let downloadAbort: AbortController | null = null;

function createTrayIcon(): Electron.NativeImage {
  const candidates = [join(__dirname, 'assets', 'tray.ico')];
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'tray.ico'));
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return nativeImage.createEmpty();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    title: APP_TITLE,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(APP_TITLE);
  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => void requestQuit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', showMainWindow);
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

async function requestQuit(): Promise<void> {
  const running = serviceManager?.runningIds() ?? [];
  if (running.length > 0) {
    const { response, checkboxChecked } = await dialog.showMessageBox({
      type: 'question',
      title: `退出 ${APP_TITLE}`,
      message: `有 ${running.length} 个服务正在运行：${running.join(', ')}`,
      detail: '是否同时停止这些服务？不勾选则服务保持后台运行。',
      buttons: ['退出', '取消'],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: '同时停止已启动的服务',
      checkboxChecked: true,
    });
    if (response === 1) return;
    if (checkboxChecked) {
      await serviceManager?.stopAll();
    }
  }
  quitting = true;
  app.quit();
}

/** 由服务名推导唯一 id；已存在时追加序号。 */
function slugServiceId(label: string): string {
  const slug = (label || 'service')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'service';
  if (!config.services[slug]) return slug;
  let n = 2;
  while (config.services[`${slug}-${n}`]) n += 1;
  return `${slug}-${n}`;
}

/** 模型目录：显式配置优先，否则沿用扫描根下的 llama.cpp/models。 */
function resolveModelsRoot(): string | null {
  if (config.modelsRoot) return config.modelsRoot;
  if (config.scanRoots[0]) return join(config.scanRoots[0], 'llama.cpp', 'models');
  return null;
}

function registerIpc(): void {
  ipcMain.handle('app:get-config', () => config);

  ipcMain.handle('app:save-config', async (_e, next: AppConfig) => {
    configStore.save(next);
    config = next;
    applyLoginItemSettings(next.autostartOnLogin);
    serviceManager?.updateRuntime(next.llamaServerPath, next.maxRestarts);
    await serviceManager?.syncServices(next.services);
    void broadcastStatus();
    return config;
  });

  // 配置快照：列出与恢复。恢复走与保存同一条重载路径，避免两套生效逻辑。
  ipcMain.handle('app:list-snapshots', () => configStore.listSnapshots());

  ipcMain.handle('app:restore-snapshot', async (_e, name: string) => {
    if (!configStore.restoreSnapshot(name)) return { ok: false };
    config = configStore.reload();
    applyLoginItemSettings(config.autostartOnLogin);
    serviceManager?.updateRuntime(config.llamaServerPath, config.maxRestarts);
    await serviceManager?.syncServices(config.services);
    void broadcastStatus();
    return { ok: true, config };
  });

  ipcMain.handle('services:status', async () => {
    const services = (await serviceManager?.viewAll()) ?? [];
    const gpu = await sampleVram();
    return { services, gpu };
  });

  ipcMain.handle('services:start', async (_e, id: string) => {
    const view = await serviceManager?.start(id);
    void broadcastStatus();
    return view;
  });

  ipcMain.handle('services:stop', async (_e, id: string) => {
    const view = (await serviceManager?.stop(id)) ?? null;
    void broadcastStatus();
    return view;
  });

  ipcMain.handle('services:restart', async (_e, id: string) => {
    const view = await serviceManager?.restart(id);
    void broadcastStatus();
    return view;
  });

  ipcMain.handle('services:log', async (_e, id: string, tail?: number) => (await serviceManager?.readLog(id, tail)) ?? '');

  ipcMain.handle('services:clear-log', (_e, id: string) => {
    serviceManager?.clearLog(id);
    return true;
  });

  // 模型扫描：默认走 10 秒缓存，force 时重新遍历
  ipcMain.handle('models:scan', async (_e, options?: { force?: boolean }) => {
    if (!config.scanRoots.length) return [];
    return scanModels(config.scanRoots, { force: options?.force === true });
  });

  ipcMain.handle('services:start-trial', async (_e, req: { model: string; mmproj?: string }) => {
    if (!req?.model) throw new Error('缺少模型路径');
    const view = await serviceManager?.startTrial(req.model, req.mmproj);
    void broadcastStatus();
    return view;
  });

  // 体验服务转正：用主进程持有的完整配置（含启动参数）写入持久配置并启动
  ipcMain.handle('services:promote', async (_e, req: { trialId: string; id?: string }) => {
    if (!serviceManager) throw new Error('服务管理器未就绪');
    const trial = serviceManager.trialConfig(req.trialId);
    if (!trial) throw new Error('体验服务不存在或已结束');
    const id = req.id?.trim() || slugServiceId(trial.label || basename(trial.model));
    if (config.services[id]) throw new Error(`服务 ${id} 已存在`);
    const persistent: ServiceConfig = { ...trial, label: trial.label || id, autostart: false, enabled: true };
    await serviceManager.dropTrial(req.trialId);
    config = { ...config, services: { ...config.services, [id]: persistent } };
    configStore.save(config);
    await serviceManager.syncServices(config.services);
    await serviceManager.start(id).catch(() => { /* 启动失败由卡片错误态呈现 */ });
    void broadcastStatus();
    return config;
  });

  ipcMain.handle('services:drop-trial', async (_e, trialId: string) => {
    await serviceManager?.dropTrial(trialId);
    void broadcastStatus();
    return true;
  });

  ipcMain.handle('models:download', async (_e, req: { name?: string; url?: string; sha256?: string }) => {
    const modelsRoot = resolveModelsRoot();
    if (!modelsRoot) return { ok: false, error: '未指定模型目录：请在设置里配置模型目录或扫描根目录' };
    if (downloadAbort) return { ok: false, error: '已有下载任务在进行中' };
    const controller = new AbortController();
    downloadAbort = controller;
    const onProgress = (receivedBytes: number, totalBytes: number) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('models:download-progress', { receivedBytes, totalBytes });
    };
    try {
      const common = { expectedSha256: req?.sha256, signal: controller.signal, onProgress };
      if (req?.url) return await downloader.downloadByUrl(req.url, modelsRoot, common);
      if (req?.name) return await downloader.downloadByName(req.name, modelsRoot, common);
      return { ok: false, error: '需要提供 name 或 url' };
    } finally {
      downloadAbort = null;
    }
  });

  ipcMain.handle('models:download-cancel', () => {
    downloadAbort?.abort();
    return true;
  });

  // 配置热加载：外部修改后由渲染层确认调用
  ipcMain.handle('app:reload-config', async () => {
    const prev = config;
    config = configStore.reload();
    applyLoginItemSettings(config.autostartOnLogin);
    serviceManager?.updateRuntime(config.llamaServerPath, config.maxRestarts);
    // 先让 syncServices 按新配置重启受影响的运行中服务（内部会等旧进程真正退出）
    await serviceManager?.syncServices(config.services);
    const restarted = Object.entries(config.services)
      .filter(([id, svc]) => prev.services[id] && serviceManager && !serviceManager.configEqual(prev.services[id], svc))
      .map(([id]) => id);
    void broadcastStatus();
    return { restarted };
  });

  ipcMain.handle('app:open-log-dir', () => {
    void shell.openPath(join(userDataDir, 'logs'));
    return true;
  });

  ipcMain.handle('app:quit', () => void requestQuit());
}

/** 状态推送合并：同一时刻只跑一次 viewAll，期间的新请求合并为一次补推。 */
let statusInFlight = false;
let statusQueued = false;

function broadcastStatus(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (statusInFlight) {
    statusQueued = true;
    return;
  }
  statusInFlight = true;
  void (async () => {
    try {
      const services = (await serviceManager?.viewAll()) ?? [];
      const gpu = await sampleVram();
      mainWindow?.webContents.send('services:changed', { services, gpu });
    } catch { /* 渲染进程可能已退出 */ } finally {
      statusInFlight = false;
      if (statusQueued) {
        statusQueued = false;
        broadcastStatus();
      }
    }
  })();
}

/** 通知渲染层配置文件被外部修改 */
function broadcastConfigChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:config-changed', {});
}

function applyLoginItemSettings(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch { /* 部分平台不支持 */ }
}

/** 清理旧版遗留的登录自启项（旧值名指向已卸载的旧安装目录）。 */
async function cleanLegacyLoginItems(): Promise<void> {
  try {
    const removed = await removeLegacyLoginItems();
    if (removed.length > 0) console.log(`已清理旧版登录自启项: ${removed.join(', ')}`);
  } catch { /* 注册表不可写时忽略 */ }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Windows: 固定 AppUserModelId，登录自启注册表键名、toast 通知与任务栏分组都依赖它
  app.setAppUserModelId('com.local.service-hub');
  app.on('second-instance', showMainWindow);

  app.whenReady().then(async () => {
    if (migration.migrated) {
      console.log(`已从旧版本目录迁移配置：${migration.from} → ${userDataDir}（${migration.copied.join(', ')}）`);
    }
    // 仅在默认 userData 位置清理注册表：显式 --user-data-dir（如冒烟测试）不改动用户系统状态
    if (isDefaultUserDataDir) void cleanLegacyLoginItems();
    applyLoginItemSettings(config.autostartOnLogin);
    serviceManager = new ServiceManager(config.llamaServerPath, config.maxRestarts, {
      logDir: join(userDataDir, 'logs'),
      vramCacheFile: join(userDataDir, 'vram-cache.json'),
      onChange: broadcastStatus,
    });
    await serviceManager.syncServices(config.services);
    registerIpc();
    configStore.watch(broadcastConfigChanged);
    createWindow();
    setupTray();

    if (process.env.SERVICE_HUB_SMOKE === '1' || process.env.LLAMA_SMOKE === '1') {
      setTimeout(() => {
        console.log('SERVICE_HUB_SMOKE_OK');
        quitting = true;
        app.exit(0);
      }, 3000);
    }
  });
}

app.on('window-all-closed', () => {
  // 托盘常驻：不在此退出
});

app.on('before-quit', () => {
  quitting = true;
});
