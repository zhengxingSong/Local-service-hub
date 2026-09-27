import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { ServiceConfig } from './config';

const execFileAsync = promisify(execFile);

export interface VramEstimate {
  /** 公式估算（MB），null 表示不参与 GPU 预算（command/compose） */
  estimateMB: number | null;
  /** 启动后 nvidia-smi 实测增量（MB），null 表示尚未采样 */
  actualMB: number | null;
}

interface CacheEntry {
  key: string;
  estimateMB: number;
  actualMB: number | null;
  updatedAt: string;
}

export interface VramEstimatorOptions {
  /** 查询进程显存占用（nvidia-smi 输出），测试可注入 */
  queryComputeApps?: () => Promise<string>;
}

const defaultQueryComputeApps = async (): Promise<string> => {
  const { stdout } = await execFileAsync(
    'nvidia-smi',
    ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'],
    { encoding: 'utf8', timeout: 8000, windowsHide: true },
  );
  return String(stdout);
};

/**
 * 显存预算估算器：先用 GGUF 文件大小 + KV 余量做公式估算，
 * 服务启动后按 nvidia-smi 采样进程显存回填实测值，后续优先用实测。
 * 缓存持久化在 userData/vram-cache.json。
 */
export class VramEstimator {
  private cacheFile: string;
  private cache: Record<string, CacheEntry> = {};
  private queryComputeApps: () => Promise<string>;

  constructor(cacheFile: string, options: VramEstimatorOptions = {}) {
    this.cacheFile = cacheFile;
    this.queryComputeApps = options.queryComputeApps ?? defaultQueryComputeApps;
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.cacheFile)) {
        this.cache = JSON.parse(readFileSync(this.cacheFile, 'utf-8')) as Record<string, CacheEntry>;
      }
    } catch { /* 缓存损坏忽略 */ }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true });
      writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch { /* 写缓存失败忽略 */ }
  }

  /** 缓存键包含模型、mmproj、上下文长度与 GPU 层数：任一变化都需重新估算。 */
  private cacheKey(config: ServiceConfig): string {
    const ctx = readArg(config.args, '--ctx-size') ?? 'default';
    const ngl = readArg(config.args, '-ngl') ?? 'default';
    return `${config.model}|${config.mmproj ?? ''}|${ctx}|${ngl}`;
  }

  /** 返回预估（优先实测回填值）。command/compose 服务返回 null。 */
  async estimate(config: ServiceConfig): Promise<VramEstimate> {
    if (!config.model || config.command || config.composeDir) {
      return { estimateMB: null, actualMB: null };
    }
    const key = this.cacheKey(config);
    const cached = this.cache[key];
    if (cached) {
      return { estimateMB: cached.estimateMB, actualMB: cached.actualMB };
    }
    let bytes = 0;
    try { bytes += (await stat(config.model)).size; } catch { /* 模型不存在时不参与估算 */ }
    if (config.mmproj) {
      try { bytes += (await stat(config.mmproj)).size; } catch { /* ignore */ }
    }
    const estimateMB = Math.round(bytes / 1024 / 1024 * 1.12); // +12% KV/计算 buffer 余量
    this.cache[key] = { key, estimateMB, actualMB: null, updatedAt: new Date().toISOString() };
    this.save();
    return { estimateMB, actualMB: null };
  }

  /** 采样某进程的显存占用并回填缓存。pid 未知或采样失败时静默跳过。 */
  async recordActual(config: ServiceConfig, pid: number | null): Promise<void> {
    if (!config.model || !pid) return;
    let used = 0;
    try {
      const out = await this.queryComputeApps();
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*(\d+),\s*([\d.]+)/);
        if (m && Number(m[1]) === pid) {
          used = Math.round(Number(m[2]));
          break;
        }
      }
    } catch { /* nvidia-smi 不可用时无法采样 */ }
    if (used <= 0) return;
    const key = this.cacheKey(config);
    const prev = this.cache[key];
    this.cache[key] = {
      key,
      estimateMB: prev?.estimateMB ?? used,
      actualMB: used,
      updatedAt: new Date().toISOString(),
    };
    this.save();
  }

  clearCache(): void {
    this.cache = {};
    try { writeFileSync(this.cacheFile, '{}'); } catch { /* ignore */ }
  }
}

/** 读取 `--key value` 形式参数的值 */
function readArg(args: string[] | undefined, key: string): string | null {
  const list = args ?? [];
  const idx = list.findIndex((a) => a === key);
  return idx >= 0 && idx + 1 < list.length ? String(list[idx + 1]) : null;
}
