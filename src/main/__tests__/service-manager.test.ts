import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceConfig } from '../config';
import { ServiceManager, type ServiceManagerDeps } from '../service-manager';

/** 假的子进程：只需满足 ServiceManager 用到的 EventEmitter 与管道接口。 */
class FakeChild extends EventEmitter {
  pid: number;
  args: string[];
  exitCode: number | null = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  constructor(pid: number, args: string[]) {
    super();
    this.pid = pid;
    this.args = args;
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  finish(code: number | null): void {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code);
    this.emit('close', code);
  }
}

/**
 * 假的进程拉起器：记录 spawn/taskkill/exit 的顺序。
 * taskkill 需要 30ms 才真正结束目标进程，用于验证启停在等待旧进程退出。
 */
class FakeSpawner {
  children = new Map<number, FakeChild>();
  events: string[] = [];
  /** 端口 → 占用该端口的 pid */
  ports = new Map<number, number>();
  private nextPid = 1000;

  spawn = ((command: string, args: string[]) => {
    if (command === 'taskkill') {
      const pid = Number(args[1]);
      this.events.push(`taskkill:${pid}`);
      const stub = new EventEmitter() as unknown as FakeChild;
      stub.stdout = new EventEmitter();
      stub.stderr = new EventEmitter();
      setTimeout(() => {
        this.children.get(pid)?.finish(0);
        (stub as unknown as EventEmitter).emit('close', 0);
      }, 30);
      return stub;
    }
    const pid = this.nextPid++;
    const child = new FakeChild(pid, args);
    this.children.set(pid, child);
    child.on('exit', () => this.events.push(`exit:${pid}`));
    const portIndex = args.indexOf('--port');
    if (portIndex >= 0) {
      const port = Number(args[portIndex + 1]);
      this.ports.set(port, pid);
      child.on('exit', () => {
        if (this.ports.get(port) === pid) this.ports.delete(port);
      });
    }
    this.events.push(`spawn:${pid}`);
    return child;
  }) as unknown as typeof import('node:child_process').spawn;

  childList(): FakeChild[] {
    return [...this.children.values()];
  }
}

const PORT = 11500;

function serviceConfig(over: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    label: '测试服务', role: '', model: '', mmproj: '', alias: 'test-alias',
    port: PORT, args: ['--ctx-size', '8192'], autostart: false, enabled: true, ...over,
  };
}

describe('服务管理器', () => {
  let dir: string;
  let spawner: FakeSpawner;
  let llamaServerPath: string;
  let modelPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hub-svc-'));
    spawner = new FakeSpawner();
    llamaServerPath = join(dir, 'llama-server.exe');
    modelPath = join(dir, 'model.gguf');
    writeFileSync(llamaServerPath, '');
    writeFileSync(modelPath, 'x');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function deps(over: Partial<ServiceManagerDeps> = {}): ServiceManagerDeps {
    return {
      logDir: join(dir, 'logs'),
      vramCacheFile: join(dir, 'vram.json'),
      onChange: () => undefined,
      spawn: spawner.spawn,
      probePort: async (port: number) => spawner.ports.has(port),
      probeHttp: async () => ({ status: 200, body: 'ok' }),
      probeModelAlias: async () => false,
      findPid: async () => null,
      ...over,
    };
  }

  function manager(over: Partial<ServiceManagerDeps> = {}, path = llamaServerPath): ServiceManager {
    return new ServiceManager(path, 5, deps(over));
  }

  it('启动服务时按配置拉起进程', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    const view = await sm.start('svc');
    expect(view.state).toBe('running');
    expect(spawner.childList()).toHaveLength(1);
    expect(spawner.childList()[0].args).toContain(modelPath);
  });

  it('配置变更时先等旧进程退出再启动新实例', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath, args: ['--ctx-size', '8192'] }) });
    await sm.start('svc');
    const first = spawner.childList()[0];
    spawner.events.length = 0;

    await sm.syncServices({ svc: serviceConfig({ model: modelPath, args: ['--ctx-size', '4096'] }) });

    const second = spawner.childList().find((c) => c.pid !== first.pid);
    expect(second).toBeDefined();
    expect(second!.args).toContain('4096');
    expect(second!.args).not.toContain('8192');
    // 顺序：先杀旧进程 → 旧进程退出 → 再拉起新实例
    const exitIndex = spawner.events.indexOf(`exit:${first.pid}`);
    const spawnIndex = spawner.events.indexOf(`spawn:${second!.pid}`);
    expect(exitIndex).toBeGreaterThanOrEqual(0);
    expect(spawnIndex).toBeGreaterThan(exitIndex);
  });

  it('配置未变化时不重启进程', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await sm.start('svc');
    const before = spawner.childList()[0];
    spawner.events.length = 0;
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    expect(spawner.childList()).toHaveLength(1);
    expect(spawner.childList()[0]).toBe(before);
    expect(spawner.events).toEqual([]);
  });

  it('仅修改显示名称不重启进程', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath, label: '旧名' }) });
    await sm.start('svc');
    spawner.events.length = 0;
    await sm.syncServices({ svc: serviceConfig({ model: modelPath, label: '新名' }) });
    expect(spawner.events).toEqual([]);
  });

  it('删除配置项会停止并移除服务', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await sm.start('svc');
    await sm.syncServices({});
    expect(sm.runningIds()).toEqual([]);
    expect(spawner.events.some((e) => e.startsWith('taskkill:'))).toBe(true);
  });

  it('保存配置不会清理体验服务', async () => {
    const sm = manager();
    const trial = await sm.startTrial(modelPath);
    expect(trial.id.startsWith('trial-')).toBe(true);
    await sm.syncServices({ other: serviceConfig({ port: 11600, model: modelPath }) });
    expect(sm.runningIds()).toContain(trial.id);
    expect(sm.trialConfig(trial.id)).not.toBeNull();
  });

  it('体验服务保留完整启动参数供转正复用', async () => {
    const sm = manager();
    const trial = await sm.startTrial(modelPath);
    const cfg = sm.trialConfig(trial.id);
    expect(cfg).not.toBeNull();
    expect(cfg!.args).toEqual(['--ctx-size', '8192', '-ngl', '99', '--jinja']);
    expect(cfg!.model).toBe(modelPath);
    expect(cfg!.port).toBe(11440);
    expect(cfg!.alias).toBe('model');
  });

  it('放弃体验服务会停止进程并移除条目', async () => {
    const sm = manager();
    const trial = await sm.startTrial(modelPath);
    await sm.dropTrial(trial.id);
    expect(sm.runningIds()).not.toContain(trial.id);
    expect(sm.trialConfig(trial.id)).toBeNull();
  });

  it('健康检查结果在 TTL 内复用', async () => {
    let probes = 0;
    const sm = manager({
      probePort: async (port: number) => { probes += 1; return spawner.ports.has(port); },
    });
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await sm.start('svc');
    probes = 0;
    await sm.viewAll();
    const afterFirst = probes;
    expect(afterFirst).toBeGreaterThan(0);
    await sm.viewAll();
    expect(probes).toBe(afterFirst);
  });

  it('并发 viewAll 合并为一次检查', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await sm.start('svc');
    const [a, b] = await Promise.all([sm.viewAll(), sm.viewAll()]);
    expect(a).toBe(b);
  });

  it('端口被无关进程占用时拒绝启动', async () => {
    spawner.ports.set(PORT, 42);
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await expect(sm.start('svc')).rejects.toThrow(/已被占用/);
    expect(spawner.childList()).toHaveLength(0);
  });

  it('端口上是同 alias 实例时接管而不是重复启动', async () => {
    spawner.ports.set(PORT, 42);
    const sm = manager({ probeModelAlias: async () => true, findPid: async () => 42 });
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    const view = await sm.start('svc');
    expect(view.state).toBe('running');
    expect(view.pid).toBe(42);
    expect(spawner.childList()).toHaveLength(0);
  });

  it('命令服务不依赖 llama-server 路径', async () => {
    const command = join(dir, 'runner.exe');
    writeFileSync(command, '');
    const sm = manager({}, '');
    await sm.syncServices({ cmd: serviceConfig({ port: 11700, model: '', command }) });
    const view = await sm.start('cmd');
    expect(view.kind).toBe('command');
    expect(view.state).toBe('running');
  });

  it('llama 服务未配置 llama-server 路径时给出明确错误', async () => {
    const sm = manager({}, '');
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await expect(sm.start('svc')).rejects.toThrow(/未配置 llama-server/);
  });

  it('模型文件不存在时拒绝启动', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: join(dir, 'missing.gguf') }) });
    await expect(sm.start('svc')).rejects.toThrow(/模型不存在/);
  });

  it('进程非零退出后按上限退避重启', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await sm.start('svc');
    const first = spawner.childList()[0];
    first.finish(1);
    // 退避 1 秒后重启
    await new Promise((resolve) => setTimeout(resolve, 1400));
    expect(spawner.childList().length).toBeGreaterThan(1);
    await sm.stop('svc');
  });

  it('停止后再次启动会复用同一端口', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await sm.start('svc');
    await sm.stop('svc');
    expect(spawner.ports.has(PORT)).toBe(false);
    const view = await sm.start('svc');
    expect(view.state).toBe('running');
  });

  it('重启会在同一串行链内完成停止与启动', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await sm.start('svc');
    const first = spawner.childList()[0];
    const view = await sm.restart('svc');
    expect(view.state).toBe('running');
    expect(spawner.events).toContain(`exit:${first.pid}`);
    expect(spawner.childList().length).toBe(2);
  });

  it('日志目录按服务落盘', async () => {
    const sm = manager();
    await sm.syncServices({ svc: serviceConfig({ model: modelPath }) });
    await sm.start('svc');
    const text = await sm.readLog('svc', 1000);
    expect(text).toContain('llama-server.exe');
  });
});
