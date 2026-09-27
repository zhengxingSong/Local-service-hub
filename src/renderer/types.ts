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
