import { execFile } from 'node:child_process';

export interface GpuInfo {
  usedMB: number;
  totalMB: number;
}

/** 采样结果缓存时长：nvidia-smi 每次调用约 35ms，2 秒缓存会让常驻应用持续拉起子进程。 */
const SAMPLE_TTL_MS = 5000;
/** 连续失败达到该次数后进入冷却，避免无 NVIDIA 驱动的机器反复拉起进程。 */
const FAILURE_LIMIT = 3;
const FAILURE_COOLDOWN_MS = 60_000;

let cache: { at: number; value: GpuInfo | null } = { at: 0, value: null };
let inFlight: Promise<GpuInfo | null> | null = null;
let failures = 0;
let disabledUntil = 0;

/**
 * 采样第一块 GPU 的显存用量。
 * 结果缓存 5 秒；并发调用共享同一次采样；连续失败 3 次后冷却 1 分钟。
 */
export function sampleVram(): Promise<GpuInfo | null> {
  if (Date.now() < disabledUntil) return Promise.resolve(cache.value);
  if (Date.now() - cache.at < SAMPLE_TTL_MS) return Promise.resolve(cache.value);
  if (inFlight) return inFlight;
  inFlight = runSample().finally(() => { inFlight = null; });
  return inFlight;
}

function runSample(): Promise<GpuInfo | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        const value = err ? null : parseFirstGpu(String(stdout));
        cache = { at: Date.now(), value };
        if (value) {
          failures = 0;
        } else {
          failures += 1;
          if (failures >= FAILURE_LIMIT) disabledUntil = Date.now() + FAILURE_COOLDOWN_MS;
        }
        resolve(value);
      },
    );
  });
}

function parseFirstGpu(out: string): GpuInfo | null {
  const line = out.trim().split(/\r?\n/)[0] ?? '';
  const parts = line.split(',').map((s) => parseInt(s.trim(), 10));
  if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    return { usedMB: parts[0], totalMB: parts[1] };
  }
  return null;
}
