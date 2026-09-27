import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface ModelEntry {
  path: string;
  name: string;
  sizeBytes: number;
  siblingMmproj: string | null;
}

export interface ScanOptions {
  /** 跳过缓存强制重新遍历 */
  force?: boolean;
  /** 缓存有效期，默认 10 秒 */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 10_000;
const MAX_DEPTH = 6;
/** 子目录并行遍历的批次大小：兼顾吞吐与文件句柄占用 */
const DIR_BATCH = 8;

let cache: { key: string; at: number; value: ModelEntry[] } | null = null;
let inFlight: { key: string; promise: Promise<ModelEntry[]> } | null = null;

function rootsKey(roots: string[]): string {
  return roots.join('|');
}

/**
 * 扫描 scanRoots 下的 GGUF（深度 ≤ 6），关联同目录的 mmproj。
 * 结果按根集合缓存 ttlMs；并发调用共享同一次遍历，避免重复全盘扫描。
 * 遍历走异步文件 API，不阻塞主进程。
 */
export async function scanModels(scanRoots: string[], opts: ScanOptions = {}): Promise<ModelEntry[]> {
  const roots = (scanRoots ?? []).filter((r): r is string => typeof r === 'string' && r.length > 0);
  const key = rootsKey(roots);
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;

  if (!opts.force && cache && cache.key === key && Date.now() - cache.at < ttl) {
    return cache.value;
  }
  if (inFlight && inFlight.key === key) return inFlight.promise;

  let promise!: Promise<ModelEntry[]>;
  promise = walkRoots(roots)
    .then((value) => {
      cache = { key, at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { key, promise };
  return promise;
}

async function walkRoots(roots: string[]): Promise<ModelEntry[]> {
  const results: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    await walk(root, 0, results, seen);
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

async function walk(dir: string, depth: number, results: ModelEntry[], seen: Set<string>): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const mmprojs = entries
    .filter((e) => e.isFile() && /^mmproj.*\.gguf$/i.test(e.name))
    .map((e) => join(dir, e.name));

  const subdirs: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      subdirs.push(join(dir, e.name));
      continue;
    }
    if (!e.isFile() || !/\.gguf$/i.test(e.name) || /^mmproj/i.test(e.name)) continue;
    const full = join(dir, e.name);
    if (seen.has(full)) continue;
    seen.add(full);
    let size = 0;
    try { size = (await stat(full)).size; } catch { /* 不可读文件按 0 计入 */ }
    results.push({ path: full, name: e.name, sizeBytes: size, siblingMmproj: mmprojs[0] ?? null });
  }

  for (let i = 0; i < subdirs.length; i += DIR_BATCH) {
    await Promise.all(subdirs.slice(i, i + DIR_BATCH).map((d) => walk(d, depth + 1, results, seen)));
  }
}
