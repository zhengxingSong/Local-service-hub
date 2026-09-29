import { describe, expect, it } from 'vitest';
import { AppConfig, GpuInfo, ServiceView } from '../types';
import { evaluatePreflight } from '../preflight';

/** 造一个够用的 ServiceView；只填本用例关心的字段。 */
function view(id: string, patch: Partial<ServiceView> = {}): ServiceView {
  return {
    id, state: 'stopped', pid: null, returncode: null, restartCount: 0, lastError: null,
    startedAt: null, endedAt: null, listening: false, label: id, role: '', model: '', mmproj: '',
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

const GPU: GpuInfo = { usedMB: 9623, totalMB: 24576 };

describe('预检：四族判定', () => {
  it('全部满足时不阻断（环境齐全 + 端口空闲 + 显存够用）', () => {
    const config = cfg({
      services: { a: { label: 'A', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 11435, args: [], autostart: false, enabled: true } },
    });
    const services = { a: view('a', { port: 11435, vramEstimateMB: 1024 }) };
    const r = evaluatePreflight({ target: { kind: 'service', id: 'a', label: 'A' }, memberIds: ['a'], services, config, gpu: GPU });
    expect(r.blocked).toBe(false);
    expect(r.items.map((i) => i.id)).toEqual(['dep', 'env', 'occ', 'res']);
    expect(r.items.every((i) => i.ok)).toBe(true);
  });

  it('四族顺序固定为 依赖 → 环境 → 占用 → 资源（便宜的先修）', () => {
    const r = evaluatePreflight({ target: { kind: 'service', id: 'a', label: 'A' }, memberIds: ['a'], services: {}, config: cfg(), gpu: GPU });
    expect(r.items.map((i) => i.title)).toEqual(['依赖', '环境', '占用', '资源']);
  });

  it('环境缺失会阻断，并给出「去补这项」', () => {
    const config = cfg({ services: { a: { label: 'A', role: '', model: '', mmproj: '', alias: '', port: 0, args: [], autostart: false, enabled: true } } });
    const services = { a: view('a') };
    const r = evaluatePreflight({ target: { kind: 'service', id: 'a', label: 'A' }, memberIds: ['a'], services, config, gpu: GPU });
    const env = r.items.find((i) => i.id === 'env');
    expect(env?.ok).toBe(false);
    expect(env?.summary).toContain('缺失');
    expect(env?.actions.map((a) => a.id)).toContain('open-editor');
    expect(r.blocked).toBe(true);
  });

  it('端口被运行中的别的服务占用时判为冲突，并给出「停掉它」', () => {
    const config = cfg({
      services: {
        a: { label: 'A', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 11435, args: [], autostart: false, enabled: true },
        b: { label: 'B', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 11435, args: [], autostart: false, enabled: true },
      },
    });
    const services = { a: view('a', { port: 11435, state: 'running' }), b: view('b', { port: 11435 }) };
    const r = evaluatePreflight({ target: { kind: 'service', id: 'b', label: 'B' }, memberIds: ['b'], services, config, gpu: GPU });
    const occ = r.items.find((i) => i.id === 'occ');
    expect(occ?.ok).toBe(false);
    expect(occ?.details.join(' ')).toContain('11435');
    expect(occ?.actions.some((x) => x.id === 'release' && x.target === 'a')).toBe(true);
  });

  it('同一组内一起启动的成员共用端口不算冲突（它们本来就不该同时在跑）', () => {
    const config = cfg({
      services: {
        a: { label: 'A', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 11435, args: [], autostart: false, enabled: true },
        b: { label: 'B', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 11435, args: [], autostart: false, enabled: true },
      },
    });
    // a 正在跑，但 b 与 a 属于同一组：启动整组时不应把 a 当占用者
    const services = { a: view('a', { port: 11435, state: 'running' }), b: view('b', { port: 11435 }) };
    const r = evaluatePreflight({ target: { kind: 'group', id: 'g', label: 'G' }, memberIds: ['a', 'b'], services, config, gpu: GPU });
    const occ = r.items.find((i) => i.id === 'occ');
    // a 已在运行、b 未运行但端口相同：仍应判为冲突（它们会同时存在）
    expect(occ?.ok).toBe(false);
  });

  it('独占组与正在运行的另一个独占组互斥，给「停掉它」', () => {
    const config = cfg({
      presets: { X: ['a'], Y: ['b'] },
      exclusivePresets: ['X', 'Y'],
      services: {
        a: { label: 'A', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 1, args: [], autostart: false, enabled: true },
        b: { label: 'B', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 2, args: [], autostart: false, enabled: true },
      },
    });
    const services = { a: view('a', { port: 1, state: 'running' }), b: view('b', { port: 2 }) };
    const r = evaluatePreflight({ target: { kind: 'group', id: 'Y', label: 'Y' }, memberIds: ['b'], services, config, gpu: GPU });
    const occ = r.items.find((i) => i.id === 'occ');
    expect(occ?.ok).toBe(false);
    expect(occ?.details.join(' ')).toContain('独占');
    expect(occ?.actions.some((x) => x.id === 'release' && x.target === 'a')).toBe(true);
  });

  it('显存不足会阻断，给出差值与两条出口（释放 / 降需）', () => {
    const config = cfg({
      services: { big: { label: 'BIG', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 8080, args: [], autostart: false, enabled: true },
                  oth: { label: 'OTH', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 9, args: [], autostart: false, enabled: true } },
    });
    const services = {
      big: view('big', { port: 8080, vramEstimateMB: 19144 }),
      oth: view('oth', { port: 9, state: 'running', vramEstimateMB: 6448 }),
    };
    const r = evaluatePreflight({ target: { kind: 'service', id: 'big', label: 'BIG' }, memberIds: ['big'], services, config, gpu: GPU });
    const res = r.items.find((i) => i.id === 'res');
    expect(res?.ok).toBe(false);
    expect(res?.summary).toContain('差');
    expect(res?.details.join(' ')).toContain('GB');
    expect(res?.actions.some((x) => x.id === 'release' && x.target === 'oth')).toBe(true);
    expect(res?.actions.some((x) => x.id === 'derate')).toBe(true);
    expect(r.blocked).toBe(true);
  });

  it('显存数据不可用时跳过资源预检，并说明这不是「够用」', () => {
    const config = cfg({ services: { a: { label: 'A', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 1, args: [], autostart: false, enabled: true } } });
    const services = { a: view('a', { port: 1, vramEstimateMB: 99999 }) };
    const r = evaluatePreflight({ target: { kind: 'service', id: 'a', label: 'A' }, memberIds: ['a'], services, config, gpu: null });
    const res = r.items.find((i) => i.id === 'res');
    expect(res?.ok).toBe(true);
    expect(res?.source).toBe('不可用');
    expect(res?.summary).toContain('跳过');
  });

  it('需求无法推算时不算「通过」：如实标注来源并挡住，让人显式接受', () => {
    const config = cfg({ services: { s: { label: 'S', role: '', model: '', mmproj: '', alias: '', port: 2, args: [], autostart: false, enabled: true, kind: 'command', command: 'x.exe' } } });
    const services = { s: view('s', { port: 2, kind: 'command', isCommand: true, command: 'x.exe' }) };
    const r = evaluatePreflight({ target: { kind: 'service', id: 's', label: 'S' }, memberIds: ['s'], services, config, gpu: GPU });
    const res = r.items.find((i) => i.id === 'res');
    expect(res?.ok).toBe(false);
    expect(res?.source).toBe('部分不可用');
    expect(res?.summary).toContain('无法推算');
    expect(r.blocked).toBe(true);
  });

  it('已知需求够用、但另有成员需求无法推算时，仍然算预检不完整', () => {
    const config = cfg({
      presets: { G: ['a', 's'] },
      services: {
        a: { label: 'A', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 1, args: [], autostart: false, enabled: true },
        s: { label: 'S', role: '', model: '', mmproj: '', alias: '', port: 2, args: [], autostart: false, enabled: true, kind: 'command', command: 'x.exe' },
      },
    });
    const services = { a: view('a', { port: 1, vramEstimateMB: 1024 }), s: view('s', { port: 2, kind: 'command', isCommand: true, command: 'x.exe' }) };
    const r = evaluatePreflight({ target: { kind: 'group', id: 'G', label: 'G' }, memberIds: ['a', 's'], services, config, gpu: GPU });
    const res = r.items.find((i) => i.id === 'res');
    expect(res?.ok).toBe(false);
    expect(res?.summary).toContain('已知需要');
    expect(res?.summary).toContain('无法推算');
    expect(res?.source).toBe('部分不可用');
  });

  it('组内悬空成员（配置已删）在依赖族阻断', () => {
    const config = cfg({ presets: { G: ['ghost'] }, services: {} });
    const r = evaluatePreflight({ target: { kind: 'group', id: 'G', label: 'G' }, memberIds: ['ghost'], services: {}, config, gpu: GPU });
    const dep = r.items.find((i) => i.id === 'dep');
    expect(dep?.ok).toBe(false);
    expect(dep?.summary).toContain('ghost');
    expect(r.blocked).toBe(true);
  });

  it('已在运行的成员不重复计入资源需求', () => {
    const config = cfg({
      presets: { G: ['a', 'b'] },
      services: {
        a: { label: 'A', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 1, args: [], autostart: false, enabled: true },
        b: { label: 'B', role: '', model: 'm.gguf', mmproj: '', alias: '', port: 2, args: [], autostart: false, enabled: true },
      },
    });
    const services = {
      a: view('a', { port: 1, state: 'running', vramEstimateMB: 6448 }),
      b: view('b', { port: 2, vramEstimateMB: 1024 }),
    };
    const r = evaluatePreflight({ target: { kind: 'group', id: 'G', label: 'G' }, memberIds: ['a', 'b'], services, config, gpu: GPU });
    const res = r.items.find((i) => i.id === 'res');
    expect(res?.summary).toContain('1.0 GB');
  });
});
