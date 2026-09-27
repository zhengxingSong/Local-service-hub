import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface DownloadResult {
  ok: boolean;
  path?: string;
  error?: string;
  /** SHA256 是否经校验通过；远端未提供摘要且调用方未指定时为 false */
  sha256Verified?: boolean;
}

export interface DownloadOptions {
  /** 期望的 SHA256（小写十六进制）；提供时下载后强制校验 */
  expectedSha256?: string;
  /** 取消下载 */
  signal?: AbortSignal;
  /** .part 文件大小变化回调，用于进度显示 */
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
}

const HF_MIRROR = 'https://hf-mirror.com';
const PREFERRED_QUANTS = ['Q4_K_M', 'Q4_0', 'Q5_K_M', 'Q8_0', 'Q6_K', 'F16'];
const MIN_PLAUSIBLE_SIZE = 1024 * 1024;
const PROGRESS_INTERVAL_MS = 1000;

interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface RepoFile {
  path: string;
  sha256: string | null;
}

/**
 * 模型下载器：经 hf-mirror 按名称搜索或直链下载 GGUF。
 * 全部子进程异步执行，不阻塞主进程；支持断点续传、大小校验与 SHA256 校验。
 */
export class ModelDownloader {
  /**
   * 按模型名在 hf-mirror 搜索仓库，优先选择 Q4_K_M 等推荐量化文件并下载。
   */
  async downloadByName(name: string, modelsRoot: string, options: DownloadOptions = {}): Promise<DownloadResult> {
    let repo = '';
    let file = '';
    let expectedSha256 = options.expectedSha256 ?? null;
    try {
      const searchUrl = `${HF_MIRROR}/api/models?search=${encodeURIComponent(name)}&limit=5`;
      const res = await runCapture('curl.exe', ['-sL', '--max-time', '30', searchUrl], { timeoutMs: 40_000 });
      const parsed = JSON.parse(res.stdout) as { id?: string; tags?: string[]; siblings?: { rfilename: string }[] }[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return { ok: false, error: `未在 hf-mirror 找到模型: ${name}` };
      }
      // 优先找标记为 GGUF 的仓库；否则找 siblings 含 .gguf 的（搜索精简响应可能无 siblings）
      const ggufTagged = parsed.find((r) => (r.tags ?? []).some((t) => /gguf/i.test(t)));
      const withGguf = parsed.find((r) => (r.siblings ?? []).some((s) => s.rfilename.endsWith('.gguf')));
      const chosen = ggufTagged ?? withGguf;
      if (!chosen?.id) {
        return { ok: false, error: `搜索结果中没有 GGUF 模型: ${name}` };
      }
      repo = chosen.id;

      // tree API 同时给出文件名与 LFS 摘要（sha256），据此选型并校验完整性。
      // 注意 repo 的 / 不能整体 URL 编码（%2F 会被 hf-mirror 拒），需按段编码
      const treePath = repo.split('/').map(encodeURIComponent).join('/');
      const detail = await runCapture('curl.exe', ['-sL', '--max-time', '30', `${HF_MIRROR}/api/models/${treePath}/tree/main`], { timeoutMs: 40_000 });
      const files = parseRepoFiles(JSON.parse(detail.stdout));
      if (files.length === 0) {
        return { ok: false, error: `${repo} 没有 GGUF 文件` };
      }
      const pick = PREFERRED_QUANTS
        .map((q) => files.find((f) => f.path.toUpperCase().includes(q)))
        .find(Boolean) ?? files[0];
      file = pick.path;
      if (!expectedSha256) expectedSha256 = pick.sha256;
    } catch (err) {
      return { ok: false, error: `搜索模型失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!repo || !file) {
      return { ok: false, error: `模型解析失败: ${name}` };
    }
    return this.downloadFile(repo, file, modelsRoot, { ...options, expectedSha256: expectedSha256 ?? undefined });
  }

  /** 直链下载（支持 hf-mirror 或任意 http(s) 直链）。 */
  async downloadByUrl(url: string, modelsRoot: string, options: DownloadOptions = {}): Promise<DownloadResult> {
    let repo = '';
    let file = '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: `仅支持 http/https 直链: ${url}` };
      }
    } catch (err) {
      return { ok: false, error: `URL 解析失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    const m = url.match(/hf-mirror\.com\/([^/]+\/[^/]+)\/resolve\/(?:[^/]+)\/([^?#]+)/);
    if (m) {
      repo = m[1];
      file = decodeURIComponent(m[2]);
    } else {
      file = basename(new URL(url).pathname);
      repo = file.replace(/\.gguf$/i, '');
    }
    if (!file) {
      return { ok: false, error: `无法从 URL 推断文件名: ${url}` };
    }
    if (!repo) {
      // 直链无法给出仓库归属时，文件本身作为目录名，避免写入 models 根目录
      return this.downloadDirect(url, file, modelsRoot, options);
    }
    return this.downloadFile(repo, file, modelsRoot, options);
  }

  /** 非 hf-mirror 直链：只做大小校验，无法从仓库取得 SHA256。 */
  private async downloadDirect(url: string, file: string, modelsRoot: string, options: DownloadOptions): Promise<DownloadResult> {
    const folderName = basename(file).replace(/\.gguf$/i, '') || 'model';
    return this.fetchToTarget(url, join(modelsRoot, folderName), file, options);
  }

  private async downloadFile(repo: string, file: string, modelsRoot: string, options: DownloadOptions): Promise<DownloadResult> {
    const folderName = basename(file).replace(/\.gguf$/i, '') || repo.split('/').pop() || 'model';
    const url = `${HF_MIRROR}/${repo}/resolve/main/${encodeURIComponent(file)}?download=true`;
    return this.fetchToTarget(url, join(modelsRoot, folderName), file, options);
  }

  private async fetchToTarget(url: string, targetDir: string, file: string, options: DownloadOptions): Promise<DownloadResult> {
    const target = join(targetDir, file);
    const part = `${target}.part`;
    const expected = options.expectedSha256?.toLowerCase() ?? null;
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      return { ok: false, error: `创建目录失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    // 已存在同名文件：有摘要则校验后再决定是否复用，避免把损坏文件当成已完成
    if (existsSync(target)) {
      if (!expected) return { ok: true, path: target, sha256Verified: false };
      const actual = await sha256File(target);
      if (actual === expected) return { ok: true, path: target, sha256Verified: true };
      try { rmSync(target, { force: true }); } catch { /* 无法删除则退回重下同名 .part */ }
    }

    // 获取远端大小（取重定向链最后一个 Content-Length；过小视为校验页而非真实文件）
    let remoteSize = -1;
    try {
      const head = await runCapture('curl.exe', ['-sIL', '--max-time', '30', url], { timeoutMs: 40_000 });
      const all = [...head.stdout.matchAll(/Content-Length:\s*(\d+)/gi)];
      const last = all.length > 0 ? Number(all[all.length - 1][1]) : -1;
      if (last > MIN_PLAUSIBLE_SIZE) remoteSize = last;
    } catch { /* 取不到则跳过大小校验 */ }

    const stopProgress = startProgressPolling(part, remoteSize, options.onProgress);
    let capture: CaptureResult;
    try {
      capture = await runCapture(
        'curl.exe',
        ['-L', '--fail', '--retry', '5', '--retry-delay', '3', '--connect-timeout', '20', '--max-time', '3600', '-C', '-', '-o', part, url],
        { signal: options.signal, timeoutMs: 3_700_000 },
      );
    } finally {
      stopProgress();
    }
    if (options.signal?.aborted) {
      return { ok: false, error: '下载已取消' };
    }
    if (capture.code !== 0) {
      const detail = capture.stderr.trim().split(/\r?\n/).pop() ?? '';
      return { ok: false, error: `下载失败 (curl exit ${capture.code})${detail ? `: ${detail}` : ''}` };
    }
    if (!existsSync(part)) {
      return { ok: false, error: '下载未产出文件' };
    }

    const size = statSync(part).size;
    if (remoteSize > 0 && size !== remoteSize) {
      return { ok: false, error: `文件大小不匹配（本地 ${size} 字节 ≠ 远端 ${remoteSize} 字节），已保留 .part 可续传` };
    }
    if (expected) {
      options.onProgress?.(size, remoteSize > 0 ? remoteSize : size);
      const actual = await sha256File(part);
      if (actual !== expected) {
        try { rmSync(part, { force: true }); } catch { /* 保留损坏分片无意义 */ }
        return { ok: false, error: `SHA256 校验失败（期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…），已删除损坏文件` };
      }
    }
    try {
      renameSync(part, target);
    } catch (err) {
      return { ok: false, error: `落盘失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { ok: true, path: target, sha256Verified: Boolean(expected) };
  }
}

/** 从 HF tree API 响应提取 GGUF 文件及其 LFS sha256。 */
export function parseRepoFiles(tree: unknown): RepoFile[] {
  if (!Array.isArray(tree)) return [];
  const files: RepoFile[] = [];
  for (const entry of tree as { type?: string; path?: string; lfs?: { oid?: string } }[]) {
    if (entry?.type !== 'file' || typeof entry.path !== 'string' || !entry.path.endsWith('.gguf')) continue;
    const oid = entry.lfs?.oid;
    files.push({ path: entry.path, sha256: typeof oid === 'string' && /^[0-9a-f]{64}$/i.test(oid) ? oid.toLowerCase() : null });
  }
  return files;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(file, { highWaterMark: 1 << 20 });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** 每秒报告一次 .part 文件大小，下载结束后停止。 */
function startProgressPolling(part: string, totalBytes: number, onProgress?: (received: number, total: number) => void): () => void {
  if (!onProgress) return () => { /* 无进度回调 */ };
  const timer = setInterval(() => {
    try {
      if (existsSync(part)) onProgress(statSync(part).size, totalBytes);
    } catch { /* 文件暂不可读时跳过本次上报 */ }
  }, PROGRESS_INTERVAL_MS);
  return () => clearInterval(timer);
}

function runCapture(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: `无法执行 ${command}: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (result: CaptureResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => { try { child.kill(); } catch { /* 进程已退出 */ } };
    const timer = setTimeout(() => {
      onAbort();
      finish({ code: -1, stdout, stderr: `${stderr}\n[超时 ${opts.timeoutMs}ms，已终止 ${command}]` });
    }, opts.timeoutMs ?? 120_000);
    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); finish({ code: -1, stdout, stderr: '已取消' }); return; }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', (err) => finish({ code: -1, stdout, stderr: `无法执行 ${command}: ${err.message}` }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}
