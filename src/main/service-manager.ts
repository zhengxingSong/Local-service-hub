import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { ServiceConfig, ServiceKind } from './config';
import { VramEstimator } from './vram-estimator';
import { appendServiceLog, clearServiceLog, readServiceLogTail } from './service-log';
import {
  canAdoptByHealthCheck,
  defaultAlias,
  matchesOpenAiModelList,
  resolveHealthCheck,
  resolveAlias,
  runHealthCheck,
  serviceKind,
  type HealthProbes,
} from './service-model';

export type ServiceState = 'stopped' | 'starting' | 'running' | 'failed' | 'restarting';

export interface ServiceView {
  id: string;
  state: ServiceState;
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
  /** 启动参数（llama 模板服务为追加参数，命令模式为命令参数），供「转正」原样复用 */
  args: string[];
  /** 启动形态 */
  kind: ServiceKind;
  /** 实际生效的就绪判定类型，供界面显示 */
  healthCheckType: string;
  autostart: boolean;
  enabled: boolean;
  /** 通用命令模式标志：true 时 model/alias 字段无意义 */
  isCommand: boolean;
  command: string;
  cwd: string;
  env: Record<string, string>;
  /** Compose 模式标志：true 时通过 docker compose 管理容器 */
  isCompose: boolean;
  composeDir: string;
  composeProfiles: string[];
  composeFile: string;
  /** 显存预估（MB），command/compose 为 null */
  vramEstimateMB: number | null;
  /** 显存实测回填（MB），未采样为 null */
  vramActualMB: number | null;
  /** 模型真实就绪（llama 服务经 /v1/models 校验 alias） */
  healthy: boolean;
}

export interface ServiceManagerDeps {
  /** 服务日志目录 */
  logDir: string;
  /** 显存缓存文件路径 */
  vramCacheFile: string;
  /** 状态变更回调 */
  onChange: () => void;
  /** 进程拉起函数，测试可注入假实现 */
  spawn?: typeof spawn;
  /** TCP 探活，测试可注入 */
  probePort?: (port: number) => Promise<boolean>;
  /** HTTP 探活，测试可注入 */
  probeHttp?: (port: number, path: string) => Promise<{ status: number; body: string }>;
  /** OpenAI 兼容模型列表校验，测试可注入 */
  probeModelAlias?: (port: number, path: string, alias: string) => Promise<boolean>;
  /** 端口 → PID 定位，测试可注入 */
  findPid?: (port: number) => Promise<number | null>;
}

/** 健康检查结果缓存时长：一次检查含 TCP 探活与 HTTP /v1/models 请求。 */
const HEALTH_TTL_MS = 2500;
/** 单服务停止后等待进程退出的上限 */
const EXIT_WAIT_MS = 8000;
/** 单服务停止后等待端口释放的上限（接管的外部实例没有 child，只能靠端口判定） */
const PORT_FREE_WAIT_MS = 5000;
/** stopAll 的整体上限，compose down 可能明显更慢 */
const STOP_ALL_MS = 20000;

class ManagedService {
  id: string;
  config: ServiceConfig;
  child: ChildProcess | null = null;
  state: ServiceState = 'stopped';
  pid: number | null = null;
  returncode: number | null = null;
  restartCount = 0;
  lastError: string | null = null;
  startedAt: string | null = null;
  endedAt: string | null = null;
  stopping = false;
  /** 本服务的操作串行链：启停、compose 与外部配置变更都不会并发进入 */
  private opChain: Promise<void> = Promise.resolve();

  constructor(id: string, config: ServiceConfig) {
    this.id = id;
    this.config = config;
  }

  get running(): boolean {
    // Compose 服务：容器由 Docker 守护，`docker compose up -d` 立即返回，
    // 以 desired state 判定运行，不能依赖 child 生命周期。
    if (this.config.composeDir) return this.state === 'running';
    // state==='running' 覆盖「接管外部同模型实例」等无 child 的场景
    return this.state === 'running' || (this.child !== null && this.child.exitCode === null && !this.child.killed);
  }

  get isCompose(): boolean {
    return Boolean(this.config.composeDir);
  }

  /** 将操作追加到本服务的串行链，保证同一服务的操作不并发 */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn);
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  view(llamaServerPath: string): ServiceView {
    return {
      id: this.id,
      state: this.state,
      pid: this.pid,
      returncode: this.returncode,
      restartCount: this.restartCount,
      lastError: this.lastError,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      listening: false,
      label: this.config.label ?? this.id,
      role: this.config.role ?? '',
      model: this.config.model ?? '',
      mmproj: this.config.mmproj ?? '',
      alias: this.config.alias || defaultAlias(this.config.model),
      port: this.config.port,
      args: [...(this.config.args ?? [])],
      kind: serviceKind(this.config),
      healthCheckType: resolveHealthCheck(this.config).type,
      autostart: this.config.autostart === true,
      enabled: this.config.enabled !== false,
      isCommand: Boolean(this.config.command),
      command: this.config.command ?? '',
      cwd: this.config.cwd ?? '',
      env: this.config.env ?? {},
      isCompose: Boolean(this.config.composeDir),
      composeDir: this.config.composeDir ?? '',
      composeProfiles: this.config.composeProfiles ?? [],
      composeFile: this.config.composeFile ?? '',
      vramEstimateMB: null,
      vramActualMB: null,
      healthy: false,
    };
  }
}

export function buildCommand(llamaServerPath: string, svc: ServiceConfig): { command: string; args: string[]; cwd?: string; env?: Record<string, string> } {
  if (svc.command) {
    // 通用命令模式：直接执行 command，args 原样传入
    return { command: svc.command, args: svc.args ?? [], cwd: svc.cwd, env: svc.env };
  }
  const args = [
    '-m', svc.model,
    '--alias', resolveAlias(svc),
    '--host', '127.0.0.1',
    '--port', String(svc.port),
  ];
  if (svc.mmproj) args.push('--mmproj', svc.mmproj);
  args.push(...(svc.args ?? []));
  return { command: llamaServerPath, args, cwd: dirname(llamaServerPath) };
}

const DOCKER_CANDIDATES = [
  'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
  'docker',
];

function findDocker(): string {
  for (const c of DOCKER_CANDIDATES) {
    if (c === 'docker' || existsSync(c)) return c;
  }
  return 'docker';
}

function composeBaseArgs(cfg: ServiceConfig): string[] {
  const args = ['compose'];
  if (cfg.composeFile) args.push('-f', cfg.composeFile);
  for (const p of cfg.composeProfiles ?? []) args.push('--profile', p);
  return args;
}

interface CaptureResult { code: number | null; output: string; }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等待子进程退出；已退出或不存在时立即返回 true。 */
function waitForExit(child: ChildProcess | null, timeoutMs: number): Promise<boolean> {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

/** 探活 127.0.0.1:port 是否可连接。 */
export function probePortDefault(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 400 });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

/** 请求 http://127.0.0.1:port/path，返回状态码与响应体；连接失败时状态码为 0。 */
export async function probeHttpDefault(port: number, path: string): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: '' };
  }
}

/** 探测端口上是否已加载指定 alias 的模型（OpenAI 兼容 /v1/models）。 */
export async function probeModelAliasDefault(port: number, path: string, alias: string): Promise<boolean> {
  const res = await probeHttpDefault(port, path);
  return res.status > 0 && matchesOpenAiModelList(res.body, alias);
}

export class ServiceManager {
  private services = new Map<string, ManagedService>();
  /** 一键体验服务 id；它们不属于持久配置，syncServices 不得清理 */
  private trials = new Set<string>();
  private llamaServerPath: string;
  private maxRestarts: number;
  private logDir: string;
  private onChange: () => void;
  private vram: VramEstimator;
  private spawnFn: typeof spawn;
  private probePort: (port: number) => Promise<boolean>;
  private probeHttp: (port: number, path: string) => Promise<{ status: number; body: string }>;
  private probeModelAlias: (port: number, path: string, alias: string) => Promise<boolean>;
  private findPid: (port: number) => Promise<number | null>;
  private healthCache = new Map<string, { key: string; at: number; value: { listening: boolean; healthy: boolean } }>();
  private viewAllInFlight: Promise<ServiceView[]> | null = null;

  constructor(llamaServerPath: string, maxRestarts: number, deps: ServiceManagerDeps) {
    this.llamaServerPath = llamaServerPath;
    this.maxRestarts = maxRestarts;
    this.logDir = deps.logDir;
    this.onChange = deps.onChange;
    this.vram = new VramEstimator(deps.vramCacheFile);
    this.spawnFn = deps.spawn ?? spawn;
    this.probePort = deps.probePort ?? probePortDefault;
    this.probeHttp = deps.probeHttp ?? probeHttpDefault;
    this.probeModelAlias = deps.probeModelAlias ?? probeModelAliasDefault;
    this.findPid = deps.findPid ?? ((port: number) => this.findPidByPort(port));
  }

  /** 当前注入的探活实现，供就绪判定复用 */
  private get probes(): HealthProbes {
    return { tcp: this.probePort, http: this.probeHttp, openaiModels: this.probeModelAlias };
  }

  updateRuntime(llamaServerPath: string, maxRestarts: number): void {
    this.llamaServerPath = llamaServerPath;
    this.maxRestarts = maxRestarts;
  }

  private notify(): void {
    try { this.onChange(); } catch { /* renderer may be gone */ }
  }

  /**
   * 让运行中的服务集合与配置一致：移除已删除的服务，替换配置变化的服务。
   * 配置变化且正在运行的服务会先等旧进程真正退出再启动新实例 —— 否则端口仍被旧进程占用，
   * 新实例会被「同 alias 接管」分支当成已在运行的实例，造成界面显示新参数、实际跑旧进程。
   * 一键体验服务不在持久配置中，由 startTrial/promoteTrial/dropTrial 管理，此处不清理。
   */
  async syncServices(configServices: Record<string, ServiceConfig>): Promise<void> {
    for (const id of [...this.services.keys()]) {
      if (this.trials.has(id)) continue;
      if (!configServices[id]) {
        await this.stop(id);
        this.services.delete(id);
      }
    }
    for (const [id, svcConfig] of Object.entries(configServices)) {
      const existing = this.services.get(id);
      if (!existing) {
        this.services.set(id, new ManagedService(id, svcConfig));
        if (svcConfig.autostart === true && svcConfig.enabled !== false) {
          await this.start(id).catch(() => { /* 单个服务启动失败不阻断其余服务 */ });
        }
        continue;
      }
      if (!this.configEqual(existing.config, svcConfig)) {
        const wasRunning = existing.running;
        if (wasRunning) await this.stop(id);
        this.services.set(id, new ManagedService(id, svcConfig));
        if (wasRunning) await this.start(id).catch(() => { /* 重启失败由卡片错误态呈现 */ });
      }
    }
  }

  configEqual(a: ServiceConfig, b: ServiceConfig): boolean {
    return (a.model ?? '') === (b.model ?? '')
      && (a.mmproj ?? '') === (b.mmproj ?? '')
      && (a.alias ?? '') === (b.alias ?? '')
      && Number(a.port) === Number(b.port)
      && JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? [])
      && (a.enabled ?? true) === (b.enabled ?? true)
      && (a.command ?? '') === (b.command ?? '')
      && (a.cwd ?? '') === (b.cwd ?? '')
      && JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {})
      && (a.composeDir ?? '') === (b.composeDir ?? '')
      && JSON.stringify(a.composeProfiles ?? []) === JSON.stringify(b.composeProfiles ?? [])
      && (a.composeFile ?? '') === (b.composeFile ?? '');
  }

  async start(id: string): Promise<ServiceView> {
    const svc = this.services.get(id);
    if (!svc) throw new Error(`未知服务: ${id}`);
    return svc.enqueue(() => this.startLocked(svc, id));
  }

  private async startLocked(svc: ManagedService, id: string): Promise<ServiceView> {
    if (svc.running) return svc.view(this.llamaServerPath);

    if (svc.isCompose) {
      if (!existsSync(svc.config.composeDir!)) {
        svc.state = 'failed';
        svc.lastError = `compose 目录不存在: ${svc.config.composeDir}`;
        this.notify();
        throw new Error(svc.lastError);
      }
      // Compose 不做端口预检：容器自身监听即占用该端口，up -d 幂等；
      // 若端口被其他程序占用导致映射冲突，docker compose up 会失败并写入日志。
      svc.state = 'starting';
      svc.lastError = null;
      svc.stopping = false;
      this.notify();
      const docker = findDocker();
      const args = [...composeBaseArgs(svc.config), 'up', '-d', '--remove-orphans'];
      this.appendLog(id, `>>> ${docker} ${args.join(' ')}\n`);
      const res = await this.runCapture(docker, args, { cwd: svc.config.composeDir!, env: svc.config.env });
      this.appendLog(id, res.output);
      if (res.code !== 0) {
        svc.state = 'failed';
        svc.lastError = `docker compose up 失败 (exit ${res.code})`;
        svc.endedAt = new Date().toISOString();
        this.notify();
        throw new Error(svc.lastError);
      }
      svc.state = 'running';
      svc.pid = null;
      svc.returncode = null;
      svc.startedAt = new Date().toISOString();
      svc.endedAt = null;
      svc.restartCount = 0;
      this.notify();
      return svc.view(this.llamaServerPath);
    }

    if (svc.config.command) {
      if (!existsSync(svc.config.command)) {
        svc.state = 'failed';
        svc.lastError = `命令不存在: ${svc.config.command}`;
        this.notify();
        throw new Error(svc.lastError);
      }
    } else {
      if (!this.llamaServerPath) {
        svc.state = 'failed';
        svc.lastError = '未配置 llama-server 路径（请在设置中指定）';
        this.notify();
        throw new Error(svc.lastError);
      }
      if (!existsSync(this.llamaServerPath)) {
        svc.state = 'failed';
        svc.lastError = `llama-server 不存在: ${this.llamaServerPath}`;
        this.notify();
        throw new Error(svc.lastError);
      }
      if (!existsSync(svc.config.model)) {
        svc.state = 'failed';
        svc.lastError = `模型不存在: ${svc.config.model}`;
        this.notify();
        throw new Error(svc.lastError);
      }
    }

    const busy = svc.config.port > 0 ? await this.probePort(svc.config.port) : false;
    if (busy) {
      // 端口被占用时先按该服务的就绪判定确认是否已是同一实例：
      // 只有能识别实例身份的判定（openai-models / http）才允许接管，避免把无关进程当成自己的服务；
      // 纯 TCP 判定无法区分身份，一律按端口冲突处理。
      const check = resolveHealthCheck(svc.config);
      const adoptable = canAdoptByHealthCheck(check);
      if (adoptable && (await runHealthCheck(svc.config, this.probes)).healthy) {
        svc.pid = await this.findPid(svc.config.port);
        svc.state = 'running';
        svc.lastError = null;
        svc.startedAt = new Date().toISOString();
        svc.restartCount = 0;
        this.appendLog(id, `>>> 端口 ${svc.config.port} 已有通过就绪判定的同实例，已接管（pid=${svc.pid ?? '未知'}）\n`);
        this.notify();
        return svc.view(this.llamaServerPath);
      }
      svc.state = 'failed';
      svc.lastError = adoptable
        ? `端口 ${svc.config.port} 已被占用，且占用进程未通过本服务的就绪判定（可能有残留进程）`
        : `端口 ${svc.config.port} 已被占用（该服务只做端口探活，无法确认是否为同一实例）`;
      this.notify();
      throw new Error(svc.lastError);
    }

    svc.state = 'starting';
    svc.lastError = null;
    svc.stopping = false;
    this.notify();

    try {
      const built = buildCommand(this.llamaServerPath, svc.config);
      this.appendLog(id, `>>> ${built.command} ${built.args.join(' ')}\n`);
      const child = this.spawnFn(built.command, built.args, {
        cwd: built.cwd ?? dirname(this.llamaServerPath),
        env: { ...process.env, ...(built.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      svc.child = child;
      svc.pid = child.pid ?? null;
      svc.state = 'running';
      svc.startedAt = new Date().toISOString();
      svc.endedAt = null;
      svc.returncode = null;
      // 启动约 5 秒后采样一次显存实测值，回填估算缓存（不阻塞主进程）
      const vramConfig = svc.config;
      const vramPid = svc.pid;
      setTimeout(() => { void this.vram.recordActual(vramConfig, vramPid); }, 5000);

      child.stdout?.on('data', (c: Buffer) => this.appendLog(id, c.toString()));
      child.stderr?.on('data', (c: Buffer) => this.appendLog(id, c.toString()));

      child.on('exit', (code: number | null) => {
        if (svc.child !== child) return;
        svc.returncode = code;
        svc.endedAt = new Date().toISOString();
        svc.pid = null;
        svc.child = null;
        if (svc.stopping) {
          svc.state = 'stopped';
          svc.stopping = false;
          this.notify();
          return;
        }
        if (code !== 0 && svc.config.enabled !== false && svc.restartCount < this.maxRestarts) {
          svc.restartCount += 1;
          svc.state = 'restarting';
          this.notify();
          const delayMs = Math.min(1000 * 2 ** (svc.restartCount - 1), 30000);
          setTimeout(() => { this.start(id).catch(() => { /* 退避重启失败保持失败态 */ }); }, delayMs);
        } else {
          svc.state = code === 0 ? 'stopped' : 'failed';
          this.notify();
        }
      });
      this.notify();
      return svc.view(this.llamaServerPath);
    } catch (err) {
      svc.state = 'failed';
      svc.lastError = err instanceof Error ? err.message : String(err);
      svc.child = null;
      this.notify();
      throw err;
    }
  }

  async stop(id: string): Promise<ServiceView | null> {
    const svc = this.services.get(id);
    if (!svc) return null;
    return svc.enqueue(() => this.stopLocked(svc, id));
  }

  private async stopLocked(svc: ManagedService, id: string): Promise<ServiceView> {
    if (svc.isCompose) {
      // desired state 先置 stopped：compose down 耗时较长，UI 立即反馈
      svc.stopping = true;
      svc.state = 'stopped';
      svc.pid = null;
      this.notify();
      const docker = findDocker();
      const args = [...composeBaseArgs(svc.config), 'down'];
      this.appendLog(id, `>>> ${docker} ${args.join(' ')}\n`);
      const res = await this.runCapture(docker, args, { cwd: svc.config.composeDir!, env: svc.config.env });
      this.appendLog(id, res.output);
      svc.stopping = false;
      if (res.code !== 0) {
        svc.state = 'failed';
        svc.lastError = `docker compose down 失败 (exit ${res.code})`;
      } else {
        svc.state = 'stopped';
        svc.lastError = null;
        svc.endedAt = new Date().toISOString();
      }
      this.notify();
      return svc.view(this.llamaServerPath);
    }

    if (!svc.running) return svc.view(this.llamaServerPath);

    svc.stopping = true;
    const child = svc.child;
    const pid = svc.pid;
    const port = svc.config.port;
    if (process.platform === 'win32' && pid) {
      await this.runCapture('taskkill', ['/PID', String(pid), '/T', '/F'], { timeoutMs: EXIT_WAIT_MS });
    } else {
      try { child?.kill(); } catch { /* 进程可能已退出 */ }
    }
    // 等进程退出，再等端口释放：接管的外部实例没有 child，只能靠端口判定
    await waitForExit(child, EXIT_WAIT_MS);
    if (port > 0) await this.waitPortFree(port, PORT_FREE_WAIT_MS);
    svc.state = 'stopped';
    svc.child = null;
    svc.pid = null;
    svc.stopping = false;
    this.notify();
    return svc.view(this.llamaServerPath);
  }

  async restart(id: string): Promise<ServiceView> {
    const svc = this.services.get(id);
    if (!svc) throw new Error(`未知服务: ${id}`);
    if (svc.isCompose) {
      if (svc.state !== 'running') return this.start(id);
      return svc.enqueue(async () => {
        const docker = findDocker();
        const args = [...composeBaseArgs(svc.config), 'restart'];
        this.appendLog(id, `>>> ${docker} ${args.join(' ')}\n`);
        const res = await this.runCapture(docker, args, { cwd: svc.config.composeDir!, env: svc.config.env });
        this.appendLog(id, res.output);
        if (res.code !== 0) {
          svc.state = 'failed';
          svc.lastError = `docker compose restart 失败 (exit ${res.code})`;
          this.notify();
          throw new Error(svc.lastError);
        }
        svc.startedAt = new Date().toISOString();
        this.notify();
        return svc.view(this.llamaServerPath);
      });
    }
    // 停止与启动在同一串行链内完成，且 stopLocked 会等到端口真正释放
    return svc.enqueue(async () => {
      await this.stopLocked(svc, id);
      return this.startLocked(svc, id);
    });
  }

  /** 汇总所有服务状态。并发调用共享同一次检查；健康检查结果在 TTL 内复用。 */
  async viewAll(): Promise<ServiceView[]> {
    if (this.viewAllInFlight) return this.viewAllInFlight;
    this.viewAllInFlight = this.buildViews().finally(() => { this.viewAllInFlight = null; });
    return this.viewAllInFlight;
  }

  private async buildViews(): Promise<ServiceView[]> {
    const entries = [...this.services.values()];
    const health = await Promise.all(entries.map((s) => this.healthOf(s)));
    return Promise.all(entries.map(async (svc, i) => {
      const view = svc.view(this.llamaServerPath);
      view.listening = health[i].listening;
      view.healthy = health[i].healthy;
      const est = await this.vram.estimate(svc.config);
      view.vramEstimateMB = est.estimateMB;
      view.vramActualMB = est.actualMB;
      return view;
    }));
  }

  private async healthOf(svc: ManagedService): Promise<{ listening: boolean; healthy: boolean }> {
    const port = svc.config.port;
    if (svc.state !== 'running' || port <= 0) return { listening: false, healthy: false };
    // 键含 state/pid 与生效的判定配置：任一变化立即失效，其余情况下 TTL 内复用上一次结果
    const check = resolveHealthCheck(svc.config);
    const key = `${svc.state}|${svc.pid ?? ''}|${port}|${check.type}|${check.path}|${check.expectAlias}|${check.expectBody ?? ''}|${check.expectStatus ?? ''}`;
    const cached = this.healthCache.get(svc.id);
    if (cached && cached.key === key && Date.now() - cached.at < HEALTH_TTL_MS) return cached.value;
    const value = await runHealthCheck(svc.config, this.probes);
    this.healthCache.set(svc.id, { key, at: Date.now(), value });
    return value;
  }

  /** 为「模型即卡片」生成推荐启动参数 */
  recommendArgs(model: string, mmproj?: string): { args: string[]; alias: string } {
    const args = ['--ctx-size', '8192', '-ngl', '99', '--jinja'];
    if (mmproj) args.unshift('--mmproj', mmproj);
    return { args, alias: defaultAlias(model) };
  }

  /**
   * 临时启动一个未配置模型的「一键体验」服务（不写入持久配置）。
   * id 以 trial- 前缀标识并登记在 trials 中，因此保存配置不会误停它。
   */
  async startTrial(model: string, mmproj?: string): Promise<ServiceView> {
    if (!existsSync(model)) {
      throw new Error(`模型不存在: ${model}`);
    }
    // 从 11440 起找第一个空闲端口
    let port = 11440;
    while (await this.probePort(port)) port += 1;
    const { args, alias } = this.recommendArgs(model, mmproj);
    const cfg: ServiceConfig = {
      label: basename(model),
      role: '',
      model,
      mmproj: mmproj ?? '',
      alias,
      port,
      args,
      autostart: false,
      enabled: true,
    };
    const id = `trial-${Date.now()}`;
    this.trials.add(id);
    this.services.set(id, new ManagedService(id, cfg));
    try {
      const view = await this.start(id);
      this.appendLog(id, `>>> 一键体验：${basename(model)} @ 端口 ${port}，转正需在界面确认\n`);
      return view;
    } catch (err) {
      this.services.delete(id);
      this.trials.delete(id);
      throw err;
    }
  }

  /** 体验服务的完整配置（含主进程生成的启动参数），供「转正」原样复用。 */
  trialConfig(id: string): ServiceConfig | null {
    if (!this.trials.has(id)) return null;
    const svc = this.services.get(id);
    return svc ? { ...svc.config, args: [...(svc.config.args ?? [])] } : null;
  }

  /** 停止并移除体验服务（转正完成或用户放弃时调用）。 */
  async dropTrial(id: string): Promise<void> {
    if (!this.trials.has(id)) return;
    await this.stop(id);
    this.services.delete(id);
    this.trials.delete(id);
  }

  runningIds(): string[] {
    return [...this.services.values()].filter((s) => s.running).map((s) => s.id);
  }

  async stopAll(): Promise<void> {
    const stops = [...this.services.values()].map((s) => this.stop(s.id));
    await Promise.race([Promise.allSettled(stops), delay(STOP_ALL_MS)]);
  }

  appendLog(id: string, text: string): void {
    appendServiceLog(this.logDir, id, text);
  }

  async readLog(id: string, tail = 2000): Promise<string> {
    const svc = this.services.get(id);
    if (svc?.isCompose) {
      try {
        const docker = findDocker();
        const args = [...composeBaseArgs(svc.config), 'logs', '--no-color', `--tail=${tail}`];
        const res = await this.runCapture(docker, args, { cwd: svc.config.composeDir!, env: svc.config.env });
        if (res.code === 0 && res.output.trim()) return res.output;
      } catch { /* docker 不可用时退回本地日志 */ }
    }
    try {
      return readServiceLogTail(this.logDir, id, tail);
    } catch {
      return '';
    }
  }

  clearLog(id: string): void {
    clearServiceLog(this.logDir, id);
  }

  private async waitPortFree(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.probePort(port))) return true;
      await delay(150);
    }
    return !(await this.probePort(port));
  }

  /** 执行外部命令并收集输出，超时与取消都会终止子进程。 */
  private runCapture(
    command: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<CaptureResult> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnFn(command, args, {
          cwd: opts.cwd,
          env: { ...process.env, ...(opts.env ?? {}) },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        resolve({ code: -1, output: `无法执行 ${command}: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
      let settled = false;
      let output = '';
      const finish = (result: CaptureResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* 进程可能已退出 */ }
        finish({ code: -1, output: `${output}\n[超时 ${opts.timeoutMs}ms，已终止 ${command}]` });
      }, opts.timeoutMs ?? 120000);
      child.stdout?.on('data', (c: Buffer) => { output += c.toString(); });
      child.stderr?.on('data', (c: Buffer) => { output += c.toString(); });
      child.on('error', (err) => finish({ code: -1, output: `无法执行 ${command}: ${err.message}` }));
      child.on('close', (code) => finish({ code, output }));
    });
  }

  /** 通过 netstat 定位监听指定端口的进程 PID（Windows）。 */
  private async findPidByPort(port: number): Promise<number | null> {
    const res = await this.runCapture('netstat', ['-ano', '-p', 'tcp'], { timeoutMs: 10000 });
    for (const line of res.output.split(/\r?\n/)) {
      const m = line.match(/\s+[\d.]+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (m && Number(m[1]) === port) return Number(m[2]);
    }
    return null;
  }
}
