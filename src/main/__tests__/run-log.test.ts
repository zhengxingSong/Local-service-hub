import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RunLog, RunTracker } from '../run-log';
import type { ServiceView } from '../service-manager';

function view(patch: Partial<ServiceView> = {}): ServiceView {
  return {
    id: 'a', state: 'stopped', pid: null, returncode: null, restartCount: 0, lastError: null,
    startedAt: null, endedAt: null, listening: false, label: 'A', role: '', model: '', mmproj: '',
    alias: '', port: 8080, args: [], kind: 'llama', healthCheckType: 'none',
    autostart: false, enabled: true, isCommand: false, command: '', cwd: '', env: {},
    isCompose: false, composeDir: '', composeProfiles: [], composeFile: '',
    vramEstimateMB: null, vramActualMB: null, healthy: false,
    ...patch,
  };
}

const T0 = new Date('2026-09-29T06:00:00.000Z');

describe('运行记录：把状态快照折叠成 Run', () => {
  it('从停止变为运行时开启一条 Run，用主进程给的 startedAt', () => {
    const t = new RunTracker();
    t.observe([view({ state: 'running', pid: 100, startedAt: T0.toISOString() })], new Date('2026-09-29T06:00:05.000Z'));
    const runs = t.list();
    expect(runs).toHaveLength(1);
    expect(runs[0].startedAt).toBe(T0.toISOString());
    expect(runs[0].outcome).toBe('running');
    expect(runs[0].endedAt).toBeNull();
    expect(runs[0].pid).toBe(100);
  });

  it('首次看到就绪时记下就绪耗时，之后不再被刷新推大', () => {
    const t = new RunTracker();
    t.observe([view({ state: 'starting', startedAt: T0.toISOString() })], new Date('2026-09-29T06:00:02.000Z'));
    t.observe([view({ state: 'running', healthy: true, startedAt: T0.toISOString() })], new Date('2026-09-29T06:00:06.500Z'));
    expect(t.list()[0].readyMs).toBe(6500);
    // 再广播几次，就绪耗时不应该继续变大
    t.observe([view({ state: 'running', healthy: true, startedAt: T0.toISOString() })], new Date('2026-09-29T06:00:30.000Z'));
    expect(t.list()[0].readyMs).toBe(6500);
  });

  it('正常停止时收尾为 stopped，带结束时间', () => {
    const t = new RunTracker();
    t.observe([view({ state: 'running', startedAt: T0.toISOString() })], new Date('2026-09-29T06:00:01.000Z'));
    t.observe([view({ state: 'stopped', startedAt: T0.toISOString(), endedAt: '2026-09-29T06:10:00.000Z' })], new Date('2026-09-29T06:10:00.000Z'));
    const r = t.list()[0];
    expect(r.outcome).toBe('stopped');
    expect(r.endedAt).toBe('2026-09-29T06:10:00.000Z');
    expect(r.pid).toBeNull();
  });

  it('失败退出时收尾为 failed 并带退出码与错误文本', () => {
    const t = new RunTracker();
    t.observe([view({ state: 'running', startedAt: T0.toISOString() })], new Date('2026-09-29T06:00:01.000Z'));
    t.observe([view({
      state: 'failed', startedAt: T0.toISOString(), endedAt: '2026-09-29T06:00:20.000Z',
      returncode: 1, lastError: 'CUDA out of memory',
    })], new Date('2026-09-29T06:00:20.000Z'));
    const r = t.list()[0];
    expect(r.outcome).toBe('failed');
    expect(r.returncode).toBe(1);
    expect(r.errorText).toBe('CUDA out of memory');
  });

  it('没观察到「活着」就失败（起步即退）也留一条记录，否则这种失败没有痕迹', () => {
    const t = new RunTracker();
    t.observe([view({ state: 'stopped' })], T0);
    t.observe([view({
      state: 'failed', startedAt: '2026-09-29T06:00:00.000Z', endedAt: '2026-09-29T06:00:01.200Z',
      returncode: 127, lastError: 'spawn ENOENT',
    })], new Date('2026-09-29T06:00:01.200Z'));
    const runs = t.list();
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe('failed');
    expect(runs[0].returncode).toBe(127);
  });

  it('同一轮失败只记一条（状态被反复广播不会刷出多条）', () => {
    const t = new RunTracker();
    const failed = view({
      state: 'failed', startedAt: '2026-09-29T06:00:00.000Z', endedAt: '2026-09-29T06:00:01.000Z', returncode: 1,
    });
    t.observe([failed], T0);
    t.observe([failed], T0);
    t.observe([failed], T0);
    expect(t.list()).toHaveLength(1);
  });

  it('没有变化时返回 false，调用方据此不刷盘', () => {
    const t = new RunTracker();
    const v = view({ state: 'running', startedAt: T0.toISOString() });
    expect(t.observe([v], T0)).toBe(true);
    expect(t.observe([v], new Date('2026-09-29T06:00:01.000Z'))).toBe(false);
  });

  it('服务从列表里消失时把它那条 Run 收尾，不留「永远进行中」', () => {
    const t = new RunTracker();
    t.observe([view({ state: 'running', startedAt: T0.toISOString() })], T0);
    t.observe([], new Date('2026-09-29T06:05:00.000Z'));
    const r = t.list()[0];
    expect(r.outcome).toBe('stopped');
    expect(r.endedAt).not.toBeNull();
  });

  it('超过上限只保留最近的记录', () => {
    const t = new RunTracker(3);
    for (let i = 0; i < 5; i += 1) {
      const s = `2026-09-29T06:0${i}:00.000Z`;
      t.observe([view({ state: 'running', startedAt: s })], new Date(`2026-09-29T06:0${i}:01.000Z`));
      t.observe([view({ state: 'stopped', startedAt: s, endedAt: `2026-09-29T06:0${i}:30.000Z` })], new Date(`2026-09-29T06:0${i}:30.000Z`));
    }
    expect(t.list()).toHaveLength(3);
  });

  it('显存峰值取本次见过的最大值', () => {
    const t = new RunTracker();
    t.observe([view({ state: 'running', startedAt: T0.toISOString(), vramActualMB: 1000 })], T0);
    t.observe([view({ state: 'running', startedAt: T0.toISOString(), vramActualMB: 1800 })], new Date('2026-09-29T06:00:05.000Z'));
    t.observe([view({ state: 'running', startedAt: T0.toISOString(), vramActualMB: 1500 })], new Date('2026-09-29T06:00:09.000Z'));
    expect(t.list()[0].vramPeakMB).toBe(1800);
  });
});

describe('运行记录：持久化', () => {
  function tempFile(): string {
    return join(mkdtempSync(join(tmpdir(), 'service-hub-runs-')), 'runs.json');
  }

  it('落盘后重新读回；上次没结束的记录保留下来，只降级为已停止且不编造结束时间', () => {
    const file = tempFile();
    const log = new RunLog(file);
    // 只启动、不停止：模拟"应用退出时它还在跑"
    log.observe([view({ state: 'running', startedAt: T0.toISOString() })], T0);
    expect(existsSync(file)).toBe(true);

    const reopened = new RunLog(file);
    const runs = reopened.list();
    expect(runs).toHaveLength(1);           // 历史没有被丢掉
    expect(runs[0].outcome).toBe('stopped');
    expect(runs[0].endedAt).toBeNull();     // 不编造一个结束时间
    expect(runs[0].pid).toBeNull();
  });

  it('文件损坏时按空历史处理，不阻止启动', () => {
    const file = tempFile();
    writeFileSync(file, '{ this is not json');
    expect(() => new RunLog(file)).not.toThrow();
    expect(new RunLog(file).list()).toHaveLength(0);
  });

  it('可按服务过滤，也可按服务清空', () => {
    const file = tempFile();
    const log = new RunLog(file);
    log.observe([
      view({ id: 'a', state: 'running', startedAt: T0.toISOString() }),
      view({ id: 'b', state: 'running', startedAt: T0.toISOString() }),
    ], T0);
    expect(log.list('a')).toHaveLength(1);
    expect(log.list()).toHaveLength(2);

    expect(log.clear('a')).toBe(1);
    expect(log.list('a')).toHaveLength(0);
    expect(log.list('b')).toHaveLength(1);
    // 清空结果也应落盘
    const reopened = new RunLog(file);
    expect(reopened.list()).toHaveLength(1);
  });

  it('落盘的是可读的 JSON 数组', () => {
    const file = tempFile();
    const log = new RunLog(file);
    log.observe([view({ state: 'running', startedAt: T0.toISOString() })], T0);
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});
