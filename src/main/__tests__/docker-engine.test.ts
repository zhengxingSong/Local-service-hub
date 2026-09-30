import { describe, expect, it } from 'vitest';
import {
  CaptureResult,
  ensureEngine,
  looksLikeUnsupportedDesktopCli,
  probeEngine,
} from '../docker-engine';

const DOCKER = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';

interface Scenario {
  /** 一开始引擎就可达（默认 false：不可达，这样才会走启动路径） */
  engineUpInitially?: boolean;
  /** 启动后第 N 次探测开始可达；不给 = 一直不可达 */
  engineUpAfterProbes?: number;
  startCode?: number;
  startOutput?: string;
  probeThrows?: boolean;
  startThrows?: boolean;
  /** 时钟推进用：每次 sleep 前进多少毫秒 */
  pollMs?: number;
  readyTimeoutMs?: number;
}

/** 假时钟 + 假 capture：把"等 120 秒"变成毫秒级且完全确定的测试。 */
function harness(s: Scenario = {}) {
  const calls: { cmd: string; args: string[] }[] = [];
  const logs: string[] = [];
  let clock = 0;
  let probes = 0;
  const pollMs = s.pollMs ?? 1000;
  const initiallyUp = s.engineUpInitially ?? false;

  const capture = async (cmd: string, args: string[]): Promise<CaptureResult> => {
    calls.push({ cmd, args });
    if (args[0] === 'version') {
      probes += 1;
      if (s.probeThrows) throw new Error('spawn docker ENOENT');
      const upAfter = s.engineUpAfterProbes;
      const up = initiallyUp || (upAfter !== undefined && probes > upAfter);
      return { code: up ? 0 : 1, output: up ? '28.0.4\n' : '' };
    }
    if (args[0] === 'desktop' && args[1] === 'start') {
      if (s.startThrows) throw new Error('spawn docker ENOENT');
      return { code: s.startCode ?? 0, output: s.startOutput ?? 'Docker Desktop is starting\n' };
    }
    return { code: 0, output: '' };
  };

  const startCalls = () => calls.filter((c) => c.args[0] === 'desktop').length;
  const probeCalls = () => calls.filter((c) => c.args[0] === 'version').length;

  const run = () =>
    ensureEngine({
      docker: DOCKER,
      capture,
      log: (l) => logs.push(l),
      pollIntervalMs: pollMs,
      readyTimeoutMs: s.readyTimeoutMs ?? 5000,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    });

  return { run, calls, logs, startCalls, probeCalls, clock: () => clock };
}

describe('Docker 引擎按需启动', () => {
  it('引擎已在时直接返回，不碰 desktop start', async () => {
    const h = harness({ engineUpInitially: true });
    const r = await h.run();
    expect(r).toEqual({ ok: true, started: false, waitedMs: 0 });
    expect(h.startCalls()).toBe(0);
    expect(h.probeCalls()).toBe(1);
  });

  it('引擎不在时启动它，并轮询到真的可达才算成功', async () => {
    // 第 3 次探测才可达 → 初始 1 次 + 循环 3 次
    const h = harness({ engineUpAfterProbes: 3 });
    const r = await h.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.started).toBe(true);
      expect(r.waitedMs).toBe(3000);
    }
    expect(h.startCalls()).toBe(1);
    expect(h.logs.join('')).toContain('Docker 引擎未运行，正在启动');
    expect(h.logs.join('')).toContain('已就绪（等待 3 秒）');
  });

  it('start 返回 0 但引擎一直不就绪时，按超时失败并让人去看 Desktop', async () => {
    const h = harness({ engineUpAfterProbes: 999, readyTimeoutMs: 4000 });
    const r = await h.run();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('timeout');
      expect(r.detail).toContain('4 秒');
      expect(r.detail).toContain('手动打开 Docker Desktop');
    }
  });

  it('等待期间按 10 秒粒度报进度，不让人以为卡死', async () => {
    const h = harness({ engineUpAfterProbes: 999, readyTimeoutMs: 25_000 });
    const r = await h.run();
    expect(r.ok).toBe(false);
    const progress = h.logs.filter((l) => l.includes('仍在等待 Docker 引擎就绪'));
    expect(progress).toHaveLength(2);   // 10s 与 20s 各一次
    expect(progress[0]).toContain('已等 10 秒');
    expect(progress[1]).toContain('已等 20 秒');
  });

  it('start 非零退出时给出退出码与首行输出', async () => {
    const h = harness({ startCode: 1, startOutput: '\nDocker Desktop failed to start: hypervisor busy\nTrace: ...\n' });
    const r = await h.run();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('start-failed');
      expect(r.detail).toContain('exit 1');
      expect(r.detail).toContain('hypervisor busy');
      expect(r.detail).not.toContain('Trace');   // 只取首行，不把整段堆进错误里
    }
  });

  it('旧版没有 desktop 子命令时单独归类，不误报成启动失败', async () => {
    const h = harness({ startCode: 1, startOutput: 'docker: \'desktop\' is not a docker command.\n' });
    const r = await h.run();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unsupported');
      expect(r.detail).toContain('没有 desktop 子命令');
      expect(r.detail).toContain('手动启动');
    }
  });

  it('探测命令本身抛错（例如 docker 不存在）视为不可达，不中断流程', async () => {
    const h = harness({ probeThrows: true, startThrows: true });
    const r = await h.run();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('start-failed');
      expect(r.detail).toContain('无法执行');
    }
  });

  it('probeEngine 只认 Server 版本，不看客户端', async () => {
    const seen: string[][] = [];
    const up = await probeEngine(DOCKER, async (_c, args) => {
      seen.push(args);
      return { code: 0, output: '28.0.4' };
    });
    expect(up).toBe(true);
    expect(seen[0]).toEqual(['version', '--format', '{{.Server.Version}}']);

    const down = await probeEngine(DOCKER, async () => ({ code: 1, output: 'error during connect' }));
    expect(down).toBe(false);
  });

  it('looksLikeUnsupportedDesktopCli 认得几种写法，认不出就当普通失败', () => {
    expect(looksLikeUnsupportedDesktopCli("docker: 'desktop' is not a docker command.")).toBe(true);
    expect(looksLikeUnsupportedDesktopCli('unknown command "desktop" for "docker"')).toBe(true);
    expect(looksLikeUnsupportedDesktopCli('error during connect: open //./pipe/...')).toBe(false);
  });
});
