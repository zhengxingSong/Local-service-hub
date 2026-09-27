import { app, BrowserWindow, dialog, ipcMain, Tray, Menu, nativeImage } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigStore, type AppConfig } from './config';
import { ServiceManager } from './service-manager';
import { ModelDownloader } from './model-downloader';
import { scanModels } from './model-scanner';
import { sampleVram } from './gpu-monitor';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const configStore = new ConfigStore();
let config: AppConfig = configStore.load();
let serviceManager: ServiceManager | null = null;
const downloader = new ModelDownloader();

function createTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createEmpty();
  return icon;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    title: 'LLaMA 模型管理器',
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
  tray.setToolTip('LLaMA 模型管理器');
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
      title: '退出 LLaMA 模型管理器',
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
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  quitting = true;
  app.quit();
}

function registerIpc(): void {
  ipcMain.handle('app:get-config', () => config);

  ipcMain.handle('app:save-config', (_e, next: AppConfig) => {
    configStore.save(next);
    const prev = config;
    config = next;
    applyLoginItemSettings(next.autostartOnLogin);
    serviceManager?.updateRuntime(next.llamaServerPath, next.maxRestarts);
    serviceManager?.syncServices(next.services);
    void broadcastStatus();
    return config;
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

  ipcMain.handle('models:scan', () => scanModels(config.scanRoots, 0));

  // P1-2 模型即卡片：临时启动未配置模型
  ipcMain.handle('services:start-trial', async (_e, req: { model: string; mmproj?: string }) => {
    if (!req?.model) throw new Error('缺少模型路径');
    const view = await serviceManager?.startTrial(req.model, req.mmproj);
    void broadcastStatus();
    return view;
  });

  // P1-3 内置下载器：按名称搜索或直链下载 GGUF
  ipcMain.handle('models:download', async (_e, req: { name?: string; url?: string }) => {
    const modelsRoot = join(config.scanRoots[0] ?? '', 'llama.cpp', 'models');
    if (req?.url) return downloader.downloadByUrl(req.url, modelsRoot);
    if (req?.name) return downloader.downloadByName(req.name, modelsRoot);
    return { ok: false, error: '需要提供 name 或 url' };
  });

  // P0-3 配置热加载：外部修改后由渲染层确认调用
  ipcMain.handle('app:reload-config', async () => {
    const prev = config;
    config = configStore.reload();
    applyLoginItemSettings(config.autostartOnLogin);
    serviceManager?.updateRuntime(config.llamaServerPath, config.maxRestarts);
    // 对比 services：参数或结构变化的运行中服务重启
    const restarted: string[] = [];
    for (const [id, svcConfig] of Object.entries(config.services)) {
      const old = prev.services[id];
      if (old && serviceManager && !serviceManager.configEqual(old, svcConfig)) {
        await serviceManager.restart(id).catch(() => {});
        restarted.push(id);
      }
    }
    serviceManager?.syncServices(config.services);
    void broadcastStatus();
    return { restarted };
  });

  ipcMain.handle('app:window-control', (_e, action: 'hide' | 'minimize' | 'close') => {
    if (action === 'hide') mainWindow?.hide();
    else if (action === 'minimize') mainWindow?.minimize();
    else if (action === 'close') mainWindow?.close();
  });

  ipcMain.handle('app:quit', () => void requestQuit());
}

function broadcastStatus(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void (async () => {
    try {
      const services = await serviceManager?.viewAll();
      const gpu = await sampleVram();
      mainWindow?.webContents.send('services:changed', { services, gpu });
    } catch { /* renderer may be gone */ }
  })();
}

/** P0-3：通知渲染层配置文件被外部修改 */
function broadcastConfigChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:config-changed', {});
}

function applyLoginItemSettings(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch { /* unsupported on some platforms */ }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Windows: 固定 AppUserModelId，登录自启注册表键名、toast 通知与任务栏分组都依赖它
  app.setAppUserModelId('com.local.llama-manager');
  app.on('second-instance', showMainWindow);

  app.whenReady().then(() => {
    applyLoginItemSettings(config.autostartOnLogin);
    serviceManager = new ServiceManager(config.llamaServerPath, config.maxRestarts, broadcastStatus);
    serviceManager.syncServices(config.services, { boot: true });
    registerIpc();
    configStore.watch(broadcastConfigChanged);
    createWindow();
    setupTray();

    if (process.env.LLAMA_SMOKE === '1') {
      setTimeout(() => {
        console.log('LLAMA_SMOKE_OK');
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
