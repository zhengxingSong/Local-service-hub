import { describe, expect, it } from 'vitest';
import { AppConfig, ServiceView } from '../types';
import { diagnose } from '../diagnose';

function view(patch: Partial<ServiceView> = {}): ServiceView {
  return {
    id: 'a', state: 'stopped', pid: null, returncode: null, restartCount: 0, lastError: null,
    startedAt: null, endedAt: null, listening: false, label: 'A', role: '', model: '', mmproj: '',
    alias: '', port: 0, args: [], kind: 'llama', healthCheckType: 'none',
    autostart: false, enabled: true, isCommand: false, command: '', cwd: '', env: {},
    isCompose: false, composeDir: '', composeProfiles: [], composeFile: '',
    vramEstimateMB: null, vramActualMB: null, healthy: false,
    ...patch,
  };
}

function cfg(patch: Partial<AppConfig> = {}): AppConfig {
  return {
    llamaServerPath: 'D:\\llama-server.exe', scanRoots: [], modelsRoot: '',
    maxRestarts: 5, autostartOnLogin: false, vramWarnThreshold: 90,
    services: {}, presets: {}, exclusivePresets: [], showModelPanel: true,
    ...patch,
  };
}

const svcCfg = { label: 'A', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 8080, args: [], autostart: false, enabled: true };
const base = cfg({ services: { a: svcCfg } });

describe('归因：把「为什么起不来」变成有证据的判断', () => {
  it('已禁用是策略不是故障，给「启用它」而不是「重试」', () => {
    const d = diagnose({ svc: view({ enabled: false, state: 'stopped' }), config: base, portOwners: {} });
    expect(d.cause).toBe('disabled');
    expect(d.actions.map((a) => a.id)).toContain('enable');
    expect(d.actions.map((a) => a.id)).not.toContain('retry');
  });

  it('运行且就绪时给出 pid / 端口 / 实测占用作为依据', () => {
    const d = diagnose({
      svc: view({ state: 'running', healthy: true, pid: 23500, port: 11435, vramActualMB: 6448 }),
      config: base, portOwners: {},
    });
    expect(d.cause).toBe('ok');
    expect(d.evidence.join(' ')).toContain('23500');
    expect(d.evidence.join(' ')).toContain('6448');
  });

  it('已停止且没有失败记录时，不编造归因', () => {
    const d = diagnose({ svc: view(), config: base, portOwners: {} });
    expect(d.cause).toBe('idle');
    expect(d.confidence).toBe('high');
    expect(d.actions.map((a) => a.id)).toContain('retry');
  });

  it('启动中且端口已在监听时，结论要区分「在听」与「就绪判定未过」', () => {
    const d = diagnose({
      svc: view({ state: 'starting', listening: true, startedAt: new Date(Date.now() - 12000).toISOString() }),
      config: base, portOwners: {},
    });
    expect(d.cause).toBe('ready');
    expect(d.title).toContain('端口已经在听');
    expect(d.evidence.join(' ')).toContain('已等待');
  });

  it('反复重启时带出重启次数与上限', () => {
    const d = diagnose({ svc: view({ state: 'restarting', restartCount: 3 }), config: base, portOwners: {} });
    expect(d.cause).toBe('crash');
    expect(d.title).toContain('第 3 次');
    expect(d.evidence.join(' ')).toContain('上限 5');
  });

  it('端口被别的服务占着时有直接证据，优先判为端口冲突并给出「停掉它」', () => {
    const config = cfg({ services: { a: svcCfg, b: { ...svcCfg, label: '占用者' } } });
    const d = diagnose({
      svc: view({ state: 'failed', port: 8080, lastError: 'bind failed' }),
      config, portOwners: { '8080': '占用者' },
    });
    expect(d.cause).toBe('port');
    expect(d.confidence).toBe('high');
    expect(d.actions.some((x) => x.id === 'release' && x.target === 'b')).toBe(true);
    expect(d.title).toContain('占用者');
  });

  it('端口被自己占着不算冲突（标签相同）', () => {
    const d = diagnose({
      svc: view({ state: 'failed', port: 8080, lastError: 'bind failed' }),
      config: base, portOwners: { '8080': 'A' },
    });
    expect(d.cause).not.toBe('port');
  });

  it('ENOENT 类错误判为环境问题，给「检查路径」', () => {
    const d = diagnose({
      svc: view({ state: 'failed', lastError: 'spawn ENOENT: 找不到 D:\\nope.exe' }),
      config: base, portOwners: {},
    });
    expect(d.cause).toBe('env');
    expect(d.actions.map((a) => a.id)).toContain('edit');
  });

  it('显存类错误判为资源问题，给「调小 ctx」', () => {
    const d = diagnose({
      svc: view({ state: 'failed', lastError: 'CUDA out of memory' }),
      config: base, portOwners: {},
    });
    expect(d.cause).toBe('resource');
    expect(d.actions.some((a) => a.label.includes('ctx'))).toBe(true);
  });

  it('没起来就退出（<3 秒）与跑了一会儿才崩（>=3 秒）要分开', () => {
    const t0 = '2026-09-29T06:00:00.000Z';
    const shortRun = diagnose({
      svc: view({ state: 'failed', startedAt: t0, endedAt: '2026-09-29T06:00:01.500Z' }),
      config: base, portOwners: {},
    });
    expect(shortRun.cause).toBe('start');
    expect(shortRun.title).toContain('立刻退出');

    const longRun = diagnose({
      svc: view({ state: 'failed', startedAt: t0, endedAt: '2026-09-29T06:00:42.000Z' }),
      config: base, portOwners: {},
    });
    expect(longRun.cause).toBe('crash');
    expect(longRun.title).toContain('运行了');
    expect(longRun.confidence).toBe('medium');
  });

  it('证据不足时降低置信度，而不是给一个看起来很确定的错答案', () => {
    const d = diagnose({ svc: view({ state: 'failed' }), config: base, portOwners: {} });
    expect(d.confidence).toBe('low');
    expect(d.title).toContain('证据');
    expect(d.evidence.join(' ')).toContain('只能靠日志');
  });
});
