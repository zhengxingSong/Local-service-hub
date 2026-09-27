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
  scanModels: () => ipcRenderer.invoke('models:scan'),
  startTrial: (model: string, mmproj?: string) => ipcRenderer.invoke('services:start-trial', { model, mmproj }),
  reloadConfig: () => ipcRenderer.invoke('app:reload-config'),
  downloadModel: (req: { name?: string; url?: string }) => ipcRenderer.invoke('models:download', req),
  windowControl: (action: 'hide' | 'minimize' | 'close') => ipcRenderer.invoke('app:window-control', action),
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
};

contextBridge.exposeInMainWorld('llamaApi', api);
