export type ServiceKind = 'llama' | 'command' | 'compose';

export type HealthCheck =
  | { type: 'none' }
  | { type: 'tcp' }
  | { type: 'http'; path?: string; expectStatus?: number; expectBody?: string }
  | { type: 'openai-models'; path?: string; expectAlias?: string };

export interface ServiceView {
  id: string;
  state: string;
  pid: number | null;
  returncode: number | null;
  restartCount: number;
  lastError: string | null;
  startedAt: string | null;
  endedAt: string | null;
  listening: boolean;
  label: string;
  role: string;
  model: string;
  mmproj: string;
  alias: string;
  port: number;
  args: string[];
  kind: ServiceKind;
  healthCheckType: string;
  autostart: boolean;
  enabled: boolean;
  isCommand: boolean;
  command: string;
  cwd: string;
  env: Record<string, string>;
  isCompose: boolean;
  composeDir: string;
  composeProfiles: string[];
  composeFile: string;
  vramEstimateMB: number | null;
  vramActualMB: number | null;
  healthy: boolean;
}

export interface GpuInfo {
  usedMB: number;
  totalMB: number;
}

export interface ModelEntry {
  path: string;
  name: string;
  sizeBytes: number;
  siblingMmproj: string | null;
}

export interface DownloadResult {
  ok: boolean;
  path?: string;
  error?: string;
  sha256Verified?: boolean;
}

/** 配置快照：配置文件的历史副本 */
export interface SnapshotInfo {
  name: string;
  createdAt: string;
  sizeBytes: number;
  reason: string;
}

/** 运行记录：一次「启动 → 结束」 */
export interface RunRecord {
  id: string;
  serviceId: string;
  label: string;
  kind: string;
  startedAt: string;
  endedAt: string | null;
  /** 启动到就绪判定通过的毫秒数；null = 未就绪或未判定 */
  readyMs: number | null;
  outcome: 'running' | 'stopped' | 'failed';
  returncode: number | null;
  pid: number | null;
  port: number;
  vramPeakMB: number | null;
  errorText: string | null;
}

export interface ServiceConfig {
  label: string;
  role: string;
  model: string;
  mmproj: string;
  alias: string;
  port: number;
  args: string[];
  autostart: boolean;
  enabled: boolean;
  kind?: ServiceKind;
  healthCheck?: HealthCheck;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  host?: string;
  composeDir?: string;
  composeProfiles?: string[];
  composeFile?: string;
}

export interface AppConfig {
  llamaServerPath: string;
  scanRoots: string[];
  modelsRoot: string;
  maxRestarts: number;
  autostartOnLogin: boolean;
  vramWarnThreshold: number;
  services: Record<string, ServiceConfig>;
  presets: Record<string, string[]>;
  exclusivePresets: string[];
  showModelPanel?: boolean;
}
