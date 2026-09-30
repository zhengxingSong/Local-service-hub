/**
 * Docker 引擎的按需启动。
 *
 * 背景：Windows 上的 `docker` 只是客户端，它把请求发给一个**需要被启动的引擎**
 * （Docker Desktop 的 Linux VM，走命名管道 `\\.\pipe\dockerDesktopLinuxEngine`）。
 * 引擎没起时，`docker compose up` 只会报一个管道错误——在界面上看起来像"服务启动失败"，
 * 而真实原因是引擎不在。用户此前的唯一办法是手动打开 Docker Desktop 的窗口。
 *
 * 这里做的事：**在启动 compose 服务前探一次引擎，不在就把它拉起来并等到真的就绪**。
 * 不做开机自启——只在需要时启动，用完随 Docker Desktop 自己的策略存在。
 *
 * 全部 IO 通过参数注入，因此本模块不需要 Electron 也不需要真的 Docker 就能单测。
 */

export interface CaptureResult {
  code: number | null;
  output: string;
}

export type Capture = (
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number; cwd?: string; env?: Record<string, string> },
) => Promise<CaptureResult>;

export interface EngineDeps {
  /** docker 可执行文件（通常由 service-manager 的 findDocker() 给出） */
  docker: string;
  capture: Capture;
  /** 进度写到哪里（一般是该服务的日志） */
  log?: (line: string) => void;
  /** 轮询间隔 */
  pollIntervalMs?: number;
  /** 启动后等引擎就绪的总超时 */
  readyTimeoutMs?: number;
  /** `docker desktop start` 自身的超时 */
  startTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type EnsureEngineResult =
  | { ok: true; started: boolean; waitedMs: number }
  | { ok: false; reason: 'start-failed' | 'timeout' | 'unsupported'; detail: string };

const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
const DEFAULT_START_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_READY_TIMEOUT_MS = 120_000;
/** 等待期间每隔多久往日志里报一次进度，免得看起来像卡死 */
const PROGRESS_EVERY_MS = 10_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0);
  return line ? line.trim() : '(无输出)';
}

/**
 * 引擎是否可达：能把 **Server 版本**读出来才算通。
 * 只看客户端版本不行——客户端永远在，引擎才是需要启动的那个。
 */
export async function probeEngine(
  docker: string,
  capture: Capture,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const res = await capture(docker, ['version', '--format', '{{.Server.Version}}'], { timeoutMs });
    return res.code === 0;
  } catch {
    // 探测失败（docker 不存在、超时、管道错误）一律视为"不可达"，由调用方决定怎么办
    return false;
  }
}

/**
 * 启动失败是不是"这个 docker 没有 desktop 子命令"。
 * 要区分出来：旧版 Docker Desktop 只提示一句"请手动启动"更诚实，
 * 而不是报成"启动失败 (exit 1)"让人去查一个不存在的故障。
 */
export function looksLikeUnsupportedDesktopCli(output: string): boolean {
  const t = output.toLowerCase();
  return (
    t.includes('is not a docker command') ||
    t.includes('unknown command') ||
    t.includes('no such command') ||
    t.includes('not a docker command')
  );
}

/**
 * 确保引擎可用：可达就直接返回；不可达则 `docker desktop start` 并轮询到就绪。
 */
export async function ensureEngine(deps: EngineDeps): Promise<EnsureEngineResult> {
  const {
    docker,
    capture,
    log = () => {},
    pollIntervalMs = DEFAULT_POLL_MS,
    readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = deps;

  if (await probeEngine(docker, capture)) return { ok: true, started: false, waitedMs: 0 };

  log('Docker 引擎未运行，正在启动…\n');
  const t0 = now();

  let started: CaptureResult;
  try {
    started = await capture(docker, ['desktop', 'start'], { timeoutMs: startTimeoutMs });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'start-failed', detail: `无法执行 \`docker desktop start\`：${detail}` };
  }
  if (started.output.trim()) log(started.output.endsWith('\n') ? started.output : `${started.output}\n`);

  if (started.code !== 0) {
    if (looksLikeUnsupportedDesktopCli(started.output)) {
      return {
        ok: false,
        reason: 'unsupported',
        detail:
          'Docker 引擎未运行，且这个 docker 没有 desktop 子命令（旧版 Docker Desktop，或引擎不是 Desktop 提供的）。'
          + '请手动启动引擎后重试。',
      };
    }
    return {
      ok: false,
      reason: 'start-failed',
      detail: `启动 Docker 引擎失败（exit ${started.code}）：${firstLine(started.output)}`,
    };
  }

  // `docker desktop start` 返回 ≠ 引擎已就绪：管道要等一会儿才出现，所以轮询到真的可达
  let reported = 0;
  for (;;) {
    const waited = now() - t0;
    if (waited >= readyTimeoutMs) {
      return {
        ok: false,
        reason: 'timeout',
        detail:
          `Docker 引擎在 ${Math.round(readyTimeoutMs / 1000)} 秒内仍未就绪。`
          + '可以手动打开 Docker Desktop 看它卡在哪一步；引擎就绪后再启动本服务即可。',
      };
    }
    await sleep(pollIntervalMs);
    if (await probeEngine(docker, capture)) {
      const total = now() - t0;
      log(`Docker 引擎已就绪（等待 ${Math.round(total / 1000)} 秒）。\n`);
      return { ok: true, started: true, waitedMs: total };
    }
    const elapsed = now() - t0;
    if (elapsed - reported >= PROGRESS_EVERY_MS) {
      reported = elapsed;
      log(`仍在等待 Docker 引擎就绪…（已等 ${Math.round(elapsed / 1000)} 秒）\n`);
    }
  }
}
