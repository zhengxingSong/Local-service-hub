import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { app } from 'electron';
import type { ServiceConfig } from './config';
import { VramEstimator } from './vram-estimator';

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

class ManagedService {
  id: string;
  config: ServiceConfig;
  child: any = null;
  state: ServiceState = 'stopped';
  pid: number | null = null;
  returncode: number | null = null;
  restartCount = 0;
  lastError: string | null = null;
  startedAt: string | null = null;
  endedAt: string | null = null;
  stopping = false;
  /** Compose 操作串行链：up/down/restart 依次执行，避免互相竞争 */
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

  /** 将操作追加到本服务的串行链，保证 compose 操作不并发 */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn);
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 等待当前链上所有操作结束（含刚入队的） */
  waitSettled(): Promise<void> {
    return this.opChain;
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

function defaultAlias(model: string): string {
  return basename(model ?? '').replace(/\.gguf$/i, '') || 'model';
}

function buildCommand(llamaServerPath: string, svc: ServiceConfig): { command: string; args: string[]; cwd?: string; env?: Record<string, string> } {
  if (svc.command) {
    // 通用命令模式：直接执行 command，args 原样传入
    return { command: svc.command, args: svc.args ?? [], cwd: svc.cwd, env: svc.env };
  }
  const args = [
    '-m', svc.model,
    '--alias', svc.alias || defaultAlias(svc.model),
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

function runCmdCapture(command: string, args: string[], opts: { cwd?: string; env?: Record<string, string> }): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', (c: Buffer) => { output += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { output += c.toString(); });
    child.on('error', (err) => resolve({ code: -1, output: `无法执行 ${command}: ${err.message}` }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

function checkListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 400 });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

/** 探测端口上是否运行着指定 alias 的模型（llama-server /v1/models） */
async function checkModelAlias(port: number, alias: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const j = (await res.json()) as { data?: { id?: string; aliases?: string[] }[] };
    return (j.data ?? []).some((m) => m.id === alias || (m.aliases ?? []).includes(alias));
  } catch {
    return false;
  }
}

/** 通过 netstat 定位监听指定端口的进程 PID（Windows） */
function findPidByPort(port: number): number | null {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/\s+[\d.]+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (m && Number(m[1]) === port) return Number(m[2]);
    }
  } catch { /* netstat 不可用时无法定位 pid */ }
  return null;
}

export class ServiceManager {
  private services = new Map<string, ManagedService>();
  private llamaServerPath: string;
  private maxRestarts: number;
  private logDir: string;
  private onChange: () => void;
  private vram = new VramEstimator();

  constructor(llamaServerPath: string, maxRestarts: number, onChange: () => void) {
    this.llamaServerPath = llamaServerPath;
    this.maxRestarts = maxRestarts;
    this.logDir = join(app.getPath('userData'), 'logs');
    this.onChange = onChange;
  }

  updateRuntime(llamaServerPath: string, maxRestarts: number): void {
    this.llamaServerPath = llamaServerPath;
    this.maxRestarts = maxRestarts;
  }

  private notify(): void {
    try { this.onChange(); } catch { /* renderer may be gone */ }
  }

  syncServices(configServices: Record<string, ServiceConfig>, { boot = false } = {}): void {
    for (const id of [...this.services.keys()]) {
      if (!configServices[id]) {
        this.stop(id);
        this.services.delete(id);
      }
    }
    for (const [id, svcConfig] of Object.entries(configServices)) {
      const existing = this.services.get(id);
      if (!existing) {
        this.services.set(id, new ManagedService(id, svcConfig));
        // boot 与运行时一致：仅 autostart && enabled 才自动拉起
        if (svcConfig.autostart === true && svcConfig.enabled !== false) {
          this.start(id).catch(() => {});
        }
        continue;
      }
      const changed = !this.configEqual(existing.config, svcConfig);
      if (changed) {
        const wasRunning = existing.running;
        this.stop(id);
        this.services.set(id, new ManagedService(id, svcConfig));
        if (wasRunning) this.start(id).catch(() => {});
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
    if (svc.running) return svc.view(this.llamaServerPath);

    if (svc.isCompose) {
      return svc.enqueue(async () => {
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
        const res = await runCmdCapture(docker, args, { cwd: svc.config.composeDir!, env: svc.config.env });
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
      });
    }

    if (svc.config.command) {
      if (!existsSync(svc.config.command)) {
        svc.state = 'failed';
        svc.lastError = `命令不存在: ${svc.config.command}`;
        this.notify();
        throw new Error(svc.lastError);
      }
    } else {
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
    const busy = svc.config.port > 0 ? await checkListening(svc.config.port) : false;
    if (busy) {
      // 端口被占用时先探测是否为同一模型实例（同 alias 的 llama-server）：
      // 是则接管为运行中（记录 PID），避免把手动/历史实例误报为残留进程；
      // 只有被其他模型或程序占用时才报错。
      const alias = svc.config.alias || defaultAlias(svc.config.model);
      if (await checkModelAlias(svc.config.port, alias)) {
        svc.pid = findPidByPort(svc.config.port);
        svc.state = 'running';
        svc.lastError = null;
        svc.startedAt = new Date().toISOString();
        svc.restartCount = 0;
        this.appendLog(id, `>>> 端口 ${svc.config.port} 已有同模型实例（${alias}），已接管（pid=${svc.pid ?? '未知'}）\n`);
        this.notify();
        return svc.view(this.llamaServerPath);
      }
      svc.state = 'failed';
      svc.lastError = `端口 ${svc.config.port} 已被占用（可能有残留进程）`;
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
      svc.child = spawn(built.command, built.args, {
        cwd: built.cwd ?? dirname(this.llamaServerPath),
        env: { ...process.env, ...(built.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      svc.pid = svc.child.pid;
      svc.state = 'running';
      svc.startedAt = new Date().toISOString();
      svc.endedAt = null;
      svc.returncode = null;
      // 启动约 5 秒后采样一次显存实测值，回填估算缓存
      const vramConfig = svc.config;
      const vramPid = svc.pid;
      setTimeout(() => this.vram.recordActual(vramConfig, vramPid), 5000);

      svc.child.stdout?.on('data', (c: Buffer) => this.appendLog(id, c.toString()));
      svc.child.stderr?.on('data', (c: Buffer) => this.appendLog(id, c.toString()));

      const child = svc.child;
      child.on('exit', (code: number) => {
        if (svc.child !== child) return;
        svc.returncode = code;
        svc.endedAt = new Date().toISOString();
        svc.pid = null;
        if (svc.stopping) {
          svc.state = 'stopped';
          svc.child = null;
          svc.stopping = false;
          this.notify();
          return;
        }
        if (code !== 0 && svc.config.enabled !== false && svc.restartCount < this.maxRestarts) {
          svc.restartCount += 1;
          svc.state = 'restarting';
          this.notify();
          const delay = Math.min(1000 * 2 ** (svc.restartCount - 1), 30000);
          setTimeout(() => { this.start(id).catch(() => {}); }, delay);
        } else {
          svc.state = code === 0 ? 'stopped' : 'failed';
          svc.child = null;
          this.notify();
        }
      });
      this.notify();
      return svc.view(this.llamaServerPath);
    } catch (err: any) {
      svc.state = 'failed';
      svc.lastError = err?.message ?? String(err);
      svc.child = null;
      this.notify();
      throw err;
    }
  }

  async stop(id: string): Promise<ServiceView | null> {
    const svc = this.services.get(id);
    if (!svc) return null;
    if (svc.isCompose) {
      return svc.enqueue(async () => {
        // desired state 先置 stopped：compose down 耗时较长，UI 立即反馈
        svc.stopping = true;
        svc.state = 'stopped';
        svc.pid = null;
        this.notify();
        const docker = findDocker();
        const args = [...composeBaseArgs(svc.config), 'down'];
        this.appendLog(id, `>>> ${docker} ${args.join(' ')}\n`);
        const res = await runCmdCapture(docker, args, { cwd: svc.config.composeDir!, env: svc.config.env });
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
      });
    }
    if (!svc.running) return svc.view(this.llamaServerPath);
    svc.stopping = true;
    if (process.platform === 'win32' && svc.pid) {
      try {
        spawn('taskkill', ['/PID', String(svc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch { /* fall through */ }
    } else {
      svc.child?.kill();
    }
    svc.state = 'stopped';
    svc.child = null;
    svc.pid = null;
    this.notify();
    return svc.view(this.llamaServerPath);
  }

  async restart(id: string): Promise<ServiceView> {
    const svc = this.services.get(id);
    if (!svc) throw new Error(`未知服务: ${id}`);
    if (svc.isCompose) {
      // 未运行时退化为 start（start 内部自会入链）
      if (svc.state !== 'running') return this.start(id);
      return svc.enqueue(async () => {
        const docker = findDocker();
        const args = [...composeBaseArgs(svc.config), 'restart'];
        this.appendLog(id, `>>> ${docker} ${args.join(' ')}\n`);
        const res = await runCmdCapture(docker, args, { cwd: svc.config.composeDir!, env: svc.config.env });
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
    await this.stop(id);
    await new Promise((r) => setTimeout(r, 800));
    return this.start(id);
  }

  async viewAll(): Promise<ServiceView[]> {
    const entries = [...this.services.values()];
    const views = entries.map((s) => s.view(this.llamaServerPath));
    const checks = await Promise.all(views.map((v) => {
      if (v.state !== 'running' || v.port <= 0) return Promise.resolve({ listening: false, healthy: false });
      return (async () => {
        const listening = await checkListening(v.port);
        // llama 模板服务：/v1/models 校验 alias 才视为真实就绪；command/compose 以 TCP 探活为准
        const svc = entries.find((s) => s.id === v.id);
        const healthy = svc && !svc.config.command && !svc.config.composeDir
          ? await checkModelAlias(v.port, v.alias)
          : listening;
        return { listening, healthy };
      })();
    }));
    views.forEach((v, i) => {
      v.listening = checks[i].listening;
      v.healthy = checks[i].healthy;
      const svc = entries[i];
      if (svc) {
        const est = this.vram.estimate(svc.config);
        v.vramEstimateMB = est.estimateMB;
        v.vramActualMB = est.actualMB;
      }
    });
    return views;
  }

  /** 为「模型即卡片」生成推荐启动参数 */
  recommendArgs(model: string, mmproj?: string): { args: string[]; alias: string } {
    const args = ['--ctx-size', '8192', '-ngl', '99', '--jinja'];
    if (mmproj) args.unshift('--mmproj', mmproj);
    return { args, alias: defaultAlias(model) };
  }

  /**
   * 临时启动一个未配置模型的「一键体验」服务（不写入持久配置）。
   * id 以 trial- 前缀标识；下次 syncServices 时如未转正会被清理。
   */
  async startTrial(model: string, mmproj?: string): Promise<ServiceView> {
    if (!existsSync(model)) {
      throw new Error(`模型不存在: ${model}`);
    }
    // 从 11440 起找第一个空闲端口
    let port = 11440;
    while (await checkListening(port)) port += 1;
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
    const svc = new ManagedService(id, cfg);
    this.services.set(id, svc);
    try {
      const view = await this.start(id);
      this.appendLog(id, `>>> 一键体验：${basename(model)} @ 端口 ${port}，转正需在界面确认\n`);
      return view;
    } catch (err) {
      this.services.delete(id);
      throw err;
    }
  }

  runningIds(): string[] {
    return [...this.services.values()].filter((s) => s.running).map((s) => s.id);
  }

  async stopAll(): Promise<void> {
    const stops = [...this.services.values()].map((s) => this.stop(s.id));
    // compose down 可能耗时较长，最多等 8 秒
    await Promise.race([Promise.allSettled(stops), new Promise((r) => setTimeout(r, 8000))]);
  }

  appendLog(id: string, text: string): void {
    try {
      mkdirSync(this.logDir, { recursive: true });
      const file = join(this.logDir, `${id}.log`);
      const stat = existsSync(file) ? statSync(file) : null;
      if (!stat || stat.size < 5 * 1024 * 1024) {
        appendFileSync(file, text);
      }
    } catch { /* logging must never crash */ }
  }

  async readLog(id: string, tail = 2000): Promise<string> {
    const svc = this.services.get(id);
    if (svc?.isCompose) {
      try {
        const docker = findDocker();
        const args = [...composeBaseArgs(svc.config), 'logs', '--no-color', `--tail=${tail}`];
        const res = await runCmdCapture(docker, args, { cwd: svc.config.composeDir!, env: svc.config.env });
        if (res.code === 0 && res.output.trim()) return res.output;
      } catch { /* docker 不可用时退回本地日志 */ }
    }
    try {
      const file = join(this.logDir, `${id}.log`);
      if (!existsSync(file)) return '';
      const text = readFileSyncSafe(file);
      return text.slice(-tail);
    } catch {
      return '';
    }
  }

  clearLog(id: string): void {
    try {
      writeFileSyncSafe(join(this.logDir, `${id}.log`), '');
    } catch { /* ignore */ }
  }
}

import { readFileSync, writeFileSync } from 'node:fs';

function readFileSyncSafe(file: string): string {
  return readFileSync(file, 'utf-8');
}
function writeFileSyncSafe(file: string, content: string): void {
  writeFileSync(file, content, 'utf-8');
}
