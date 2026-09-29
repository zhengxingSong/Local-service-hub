import type { AppConfig, DownloadResult, GpuInfo, ModelEntry, ServiceView, SnapshotInfo } from './types';

export {};

declare global {
  interface Window {
    serviceHubApi: {
      getConfig: () => Promise<AppConfig>;
      saveConfig: (config: AppConfig) => Promise<AppConfig>;
      status: () => Promise<{ services: ServiceView[]; gpu: GpuInfo | null }>;
      start: (id: string) => Promise<ServiceView>;
      stop: (id: string) => Promise<ServiceView | null>;
      restart: (id: string) => Promise<ServiceView>;
      getLog: (id: string, tail?: number) => Promise<string>;
      clearLog: (id: string) => Promise<boolean>;
      scanModels: (options?: { force?: boolean }) => Promise<ModelEntry[]>;
      startTrial: (model: string, mmproj?: string) => Promise<ServiceView>;
      promote: (req: { trialId: string; id?: string }) => Promise<AppConfig>;
      dropTrial: (trialId: string) => Promise<boolean>;
      reloadConfig: () => Promise<{ restarted: string[] }>;
      listSnapshots: () => Promise<SnapshotInfo[]>;
      restoreSnapshot: (name: string) => Promise<{ ok: boolean; config?: AppConfig }>;
      downloadModel: (req: { name?: string; url?: string; sha256?: string }) => Promise<DownloadResult>;
      cancelDownload: () => Promise<boolean>;
      openLogDir: () => Promise<boolean>;
      quit: () => Promise<void>;
      onServicesChanged: (cb: (payload: { services: ServiceView[]; gpu: GpuInfo | null }) => void) => () => void;
      onConfigChanged: (cb: () => void) => () => void;
      onDownloadProgress: (cb: (payload: { receivedBytes: number; totalBytes: number }) => void) => () => void;
    };
  }
}
