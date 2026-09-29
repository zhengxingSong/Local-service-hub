import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, watchFile, unwatchFile, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** 服务的启动形态。旧配置没有该字段，由 serviceKind() 按已有字段推断。 */
export type ServiceKind = 'llama' | 'command' | 'compose';

/**
 * 就绪判定方式。
 * - none：不做探活，视为已就绪
 * - tcp：端口可连接即就绪
 * - http：请求 path 并校验状态码/响应体（响应体支持 {{alias}}/{{model}}/{{port}} 占位）
 * - openai-models：解析 OpenAI 兼容的 /v1/models 响应，校验指定 alias 已加载
 */
export type HealthCheck =
  | { type: 'none' }
  | { type: 'tcp' }
  | { type: 'http'; path?: string; expectStatus?: number; expectBody?: string }
  | { type: 'openai-models'; path?: string; expectAlias?: string };

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
  /** 启动形态；缺省时按 command/composeDir 推断 */
  kind?: ServiceKind;
  /** 就绪判定；缺省时 llama 形态用 openai-models，其余用 tcp */
  healthCheck?: HealthCheck;
  /** 通用命令模式：非空时直接执行该命令（无视 llama 模板），args 作为其参数 */
  command?: string;
  /** 通用命令模式：工作目录 */
  cwd?: string;
  /** 通用命令模式：附加环境变量 */
  env?: Record<string, string>;
  /** 预留：远程主机地址，默认本机；当前仅存储不生效 */
  host?: string;
  /** Compose 模式：非空时通过 docker compose 管理；值为 compose 文件所在目录 */
  composeDir?: string;
  /** Compose 模式：可选 --profile 参数 */
  composeProfiles?: string[];
  /** Compose 模式：可选 compose 文件路径（默认 composeDir 下自动发现） */
  composeFile?: string;
}

export interface AppConfig {
  /** llama-server 可执行文件路径；为空表示不使用 llama 能力 */
  llamaServerPath: string;
  /** GGUF 扫描根目录；为空表示不扫描模型 */
  scanRoots: string[];
  /** 模型下载目录；为空时沿用 scanRoots[0]/llama.cpp/models */
  modelsRoot: string;
  maxRestarts: number;
  autostartOnLogin: boolean;
  vramWarnThreshold: number;
  services: Record<string, ServiceConfig>;
  presets: Record<string, string[]>;
  /** 独占运行预设组名列表：启动其中一组时提示停止其他运行中的组 */
  exclusivePresets: string[];
  /** 是否显示 llama 面板（模型库 / 一键体验 / 显存估算）；未配置 llama 能力时不显示 */
  showModelPanel?: boolean;
}

/**
 * 默认配置不含任何与本机路径绑定的服务：
 * 服务与预设组由用户创建，或由旧版本配置文件迁移带入。
 */
export function defaultConfig(): AppConfig {
  return {
    llamaServerPath: '',
    scanRoots: [],
    modelsRoot: '',
    maxRestarts: 5,
    autostartOnLogin: false,
    vramWarnThreshold: 90,
    services: {},
    presets: {},
    exclusivePresets: [],
    showModelPanel: true,
  };
}

/** 未知服务及缺失字段的兜底值。 */
const EMPTY_SERVICE: ServiceConfig = {
  label: '',
  role: '',
  model: '',
  mmproj: '',
  alias: '',
  port: 0,
  args: [],
  autostart: false,
  enabled: true,
};

/**
 * 读取边界布尔归一化：接受布尔与常见的字符串/数字写法（true/1/yes/on），
 * 无法识别时回退到默认值。配置文件可能被手工编辑。
 */
function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : fallback;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'off', ''].includes(text)) return false;
  }
  return fallback;
}

/** 读取边界归一化：配置文件可能被手工编辑，字段类型不可信。 */
function normalizeService(raw: unknown, fallback: ServiceConfig = EMPTY_SERVICE): ServiceConfig {
  const svc = { ...fallback, ...(raw as Partial<ServiceConfig>) };
  return {
    ...svc,
    args: Array.isArray(svc.args) ? svc.args.map(String) : [],
    port: Number.isFinite(Number(svc.port)) ? Number(svc.port) : 0,
    autostart: toBoolean(svc.autostart, false),
    enabled: toBoolean(svc.enabled, true),
    composeProfiles: Array.isArray(svc.composeProfiles) ? svc.composeProfiles.map(String) : [],
  };
}

/**
 * 合并磁盘配置与内置默认值。
 * 服务与预设组的存在性以磁盘为准（删除内置项后不再复活）；
 * 保留项先按同 id 的内置默认值补齐，再按通用兜底值补齐并归一化字段类型。
 * 整段缺失（旧版本配置文件或手工裁剪过的文件）才回退到内置默认集合。
 */
export function mergeLoadedConfig(raw: unknown, base: AppConfig): AppConfig {
  const source = (raw ?? {}) as Partial<AppConfig>;
  const diskServices = source.services && typeof source.services === 'object' ? source.services : base.services;
  const services: Record<string, ServiceConfig> = {};
  for (const [id, svc] of Object.entries(diskServices)) {
    services[id] = normalizeService(svc, base.services[id] ?? EMPTY_SERVICE);
  }
  return {
    ...base,
    ...source,
    services,
    presets: source.presets && typeof source.presets === 'object' ? source.presets : base.presets,
    exclusivePresets: Array.isArray(source.exclusivePresets) ? source.exclusivePresets : [],
  };
}

/** 自身写入后忽略外部变更回调的时间窗：watchFile 轮询间隔 1500ms，留出余量。 */
const SELF_WRITE_WINDOW_MS = 2500;

/* ============================ 配置快照 ============================ */

/** 一份配置快照。 */
export interface SnapshotInfo {
  /** 文件名（不含目录）；恢复时用它定位 */
  name: string;
  /** ISO 时间 */
  createdAt: string;
  sizeBytes: number;
  /** 为什么存的：保存前 / 恢复前 / 旧版迁移 */
  reason: string;
}

const SNAPSHOT_MARK = '.bak-';
const SNAPSHOT_MANIFEST = '.snapshots.json';
/** 保留份数：快照是退路，不是备份系统，超过就删最旧的。 */
export const SNAPSHOT_KEEP = 10;

function snapshotStamp(at: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  // 带毫秒：同一秒内连续两次保存不能撞同一个文件名（否则后写的会覆盖前一份）
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}${p(at.getMilliseconds(), 3)}`;
}

function manifestOf(file: string): string {
  return `${file}${SNAPSHOT_MANIFEST}`;
}

function readManifest(file: string): Record<string, { reason?: string; createdAt?: string }> {
  try {
    return JSON.parse(readFileSync(manifestOf(file), 'utf-8')) as Record<string, { reason?: string; createdAt?: string }>;
  } catch {
    return {};
  }
}

/**
 * 清单写失败不算失败：快照本体已经落盘，清单只承载「为什么存的」这一条说明。
 * 没有清单记录的旧版迁移文件同样能被列出，原因显示为「旧版迁移」。
 */
function writeManifest(file: string, data: unknown): void {
  try {
    writeFileSync(manifestOf(file), JSON.stringify(data, null, 2));
  } catch { /* 见上：说明性数据，丢了不影响快照可用 */ }
}

/** 列出快照，最新的在前。 */
export function listSnapshotsFor(file: string): SnapshotInfo[] {
  const dir = dirname(file);
  const prefix = basename(file) + SNAPSHOT_MARK;
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.startsWith(prefix));
  } catch {
    return [];
  }
  const manifest = readManifest(file);
  const items: SnapshotInfo[] = [];
  for (const name of names) {
    try {
      const st = statSync(join(dir, name));
      const meta = manifest[name];
      items.push({
        name,
        createdAt: meta?.createdAt ?? st.mtime.toISOString(),
        sizeBytes: st.size,
        reason: meta?.reason ?? '旧版迁移',
      });
    } catch { /* 读不到的条目跳过，不影响其余快照 */ }
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * 存一份快照。文件不存在、或内容与最新一份相同时不存（连续保存不产生噪音）。
 * 返回新建的文件名；未新建时返回 null。
 */
export function createSnapshotFor(file: string, reason: string): string | null {
  if (!existsSync(file)) return null;
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  const existing = listSnapshotsFor(file);
  if (existing.length > 0) {
    try {
      const newest = readFileSync(join(dirname(file), existing[0].name), 'utf-8');
      if (newest === text) return null;
    } catch { /* 读不到最新快照就照常新建 */ }
  }
  const name = `${basename(file)}${SNAPSHOT_MARK}${snapshotStamp(new Date())}`;
  try {
    writeFileSync(join(dirname(file), name), text);
  } catch {
    return null;
  }
  const manifest = readManifest(file);
  manifest[name] = { reason, createdAt: new Date().toISOString() };
  const sorted = [...existing.map((e) => e.name), name].sort();
  for (const old of sorted.slice(0, Math.max(0, sorted.length - SNAPSHOT_KEEP))) {
    try {
      unlinkSync(join(dirname(file), old));
    } catch { /* 删不掉就留着，不影响正确性 */ }
    delete manifest[old];
  }
  writeManifest(file, manifest);
  return name;
}

/**
 * 恢复快照。恢复前先给「当前配置」存一份，所以这一步本身可逆。
 * name 来自渲染层，必须校验：只接受裸文件名，且必须是本配置文件自己的快照。
 */
export function restoreSnapshotFor(file: string, name: string): boolean {
  if (!name || basename(name) !== name) return false;
  if (!name.startsWith(basename(file) + SNAPSHOT_MARK)) return false;
  const from = join(dirname(file), name);
  if (!existsSync(from)) return false;
  createSnapshotFor(file, '恢复前');
  try {
    copyFileSync(from, file);
    return true;
  } catch {
    return false;
  }
}

export class ConfigStore {
  private file: string;
  /** 最近一次自身写入的时间戳，用于区分外部修改 */
  private lastSelfWriteAt = 0;

  constructor(file: string) {
    this.file = file;
  }

  load(): AppConfig {
    if (!existsSync(this.file)) {
      const cfg = defaultConfig();
      this.save(cfg);
      return cfg;
    }
    try {
      return mergeLoadedConfig(JSON.parse(readFileSync(this.file, 'utf-8')), defaultConfig());
    } catch {
      return defaultConfig();
    }
  }

  save(config: AppConfig): void {
    const text = JSON.stringify(config, null, 2);
    let current: string | null = null;
    try {
      current = readFileSync(this.file, 'utf-8');
    } catch {
      current = null; // 首次保存：没有上一份
    }
    // 内容真的没变就不写盘、也不留快照——否则连续保存会刷出一串无意义的快照。
    if (current === text) {
      this.lastSelfWriteAt = Date.now();
      return;
    }
    // 改动前先留退路；此时文件里还是旧内容。
    createSnapshotFor(this.file, '保存前');
    this.lastSelfWriteAt = Date.now();
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, text);
  }

  /** 重新从磁盘读取（外部修改后热加载用） */
  reload(): AppConfig {
    return this.load();
  }

  /** 列出配置快照，最新的在前。 */
  listSnapshots(): SnapshotInfo[] {
    return listSnapshotsFor(this.file);
  }

  /** 恢复某个快照；恢复前会自动给当前配置存一份，所以这一步本身可逆。 */
  restoreSnapshot(name: string): boolean {
    const ok = restoreSnapshotFor(this.file, name);
    if (ok) this.lastSelfWriteAt = Date.now();
    return ok;
  }

  /**
   * 监听配置文件的外部修改。自身写入通过时间窗抑制，
   * 不用一次性标志位，避免自身写入的回调未触发时永久吞掉后续外部变更。
   * 返回停止监听的函数。
   */
  watch(onExternalChange: () => void): () => void {
    watchFile(this.file, { interval: 1500 }, () => {
      if (Date.now() - this.lastSelfWriteAt < SELF_WRITE_WINDOW_MS) return;
      onExternalChange();
    });
    return () => {
      unwatchFile(this.file);
    };
  }
}
