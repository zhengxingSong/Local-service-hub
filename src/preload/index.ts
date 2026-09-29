import { contextBridge, ipcRenderer } from 'electron';

export interface ServiceView {
  id: string;
  state: string;
  pid: number | null;
  restartCount: number;
  lastError: string | null;
  label: string;
  role: string;
  model: string;
  mmproj: string;
  alias: string;
  port: number;
  args: string[];
  kind: string;
  healthCheckType: string;
  autostart: boolean;
  enabled: boolean;
  listening: boolean;
  vramEstimateMB: number | null;
  vramActualMB: number | null;
  healthy: boolean;
}

export interface GpuInfo {
  usedMB: number;
  totalMB: number;
}

export interface DownloadResult {
  ok: boolean;
  path?: string;
  error?: string;
  sha256Verified?: boolean;
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

/** 配置快照：配置文件的历史副本，用于「改坏了能退回去」 */
export interface SnapshotInfo {
  name: string;
  createdAt: string;
  sizeBytes: number;
  reason: string;
}

const api = {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('app:save-config', config),
  status: () => ipcRenderer.invoke('services:status'),
  start: (id: string) => ipcRenderer.invoke('services:start', id),
  stop: (id: string) => ipcRenderer.invoke('services:stop', id),
  restart: (id: string) => ipcRenderer.invoke('services:restart', id),
  getLog: (id: string, tail?: number) => ipcRenderer.invoke('services:log', id, tail),
  clearLog: (id: string) => ipcRenderer.invoke('services:clear-log', id),
  scanModels: (options?: { force?: boolean }) => ipcRenderer.invoke('models:scan', options),
  startTrial: (model: string, mmproj?: string) => ipcRenderer.invoke('services:start-trial', { model, mmproj }),
  promote: (req: { trialId: string; id?: string }) => ipcRenderer.invoke('services:promote', req),
  dropTrial: (trialId: string) => ipcRenderer.invoke('services:drop-trial', trialId),
  reloadConfig: () => ipcRenderer.invoke('app:reload-config'),
  listSnapshots: () => ipcRenderer.invoke('app:list-snapshots'),
  restoreSnapshot: (name: string) => ipcRenderer.invoke('app:restore-snapshot', name),
  listRuns: (serviceId?: string, limit?: number) => ipcRenderer.invoke('runs:list', serviceId, limit),
  clearRuns: (serviceId?: string) => ipcRenderer.invoke('runs:clear', serviceId),
  downloadModel: (req: { name?: string; url?: string; sha256?: string }) => ipcRenderer.invoke('models:download', req),
  cancelDownload: () => ipcRenderer.invoke('models:download-cancel'),
  openLogDir: () => ipcRenderer.invoke('app:open-log-dir'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onServicesChanged: (cb: (payload: { services: ServiceView[]; gpu: GpuInfo | null }) => void) => {
    const listener = (_e: unknown, payload: { services: ServiceView[]; gpu: GpuInfo | null }) => cb(payload);
    ipcRenderer.on('services:changed', listener);
    return () => ipcRenderer.removeListener('services:changed', listener);
  },
  onConfigChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('app:config-changed', listener);
    return () => ipcRenderer.removeListener('app:config-changed', listener);
  },
  onDownloadProgress: (cb: (payload: DownloadProgress) => void) => {
    const listener = (_e: unknown, payload: DownloadProgress) => cb(payload);
    ipcRenderer.on('models:download-progress', listener);
    return () => ipcRenderer.removeListener('models:download-progress', listener);
  },
};

contextBridge.exposeInMainWorld('serviceHubApi', api);
