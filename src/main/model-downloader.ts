import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface DownloadResult {
  ok: boolean;
  path?: string;
  error?: string;
}

const HF_MIRROR = 'https://hf-mirror.com';
const PREFERRED_QUANTS = ['Q4_K_M', 'Q4_0', 'Q5_K_M', 'Q8_0', 'Q6_K', 'F16'];

/**
 * 模型下载器：经 hf-mirror 按名称搜索或直链下载 GGUF，
 * 用 curl.exe 断点续传（-C -），完成后校验远端 Content-Length 是否一致。
 */
export class ModelDownloader {
  /**
   * 按模型名在 hf-mirror 搜索仓库，优先选择 Q4_K_M 等推荐量化文件并下载。
   */
  async downloadByName(name: string, modelsRoot: string): Promise<DownloadResult> {
    let repo = '';
    let file = '';
    try {
      const api = `${HF_MIRROR}/api/models?search=${encodeURIComponent(name)}&limit=5`;
      const res = execFileSync('curl.exe', ['-sL', '--max-time', '30', api], { encoding: 'utf8', windowsHide: true });
      const parsed = JSON.parse(res) as { id?: string; tags?: string[]; siblings?: { rfilename: string }[] }[];
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
      if (withGguf) {
        const ggufs = (withGguf.siblings ?? []).map((s) => s.rfilename).filter((f) => f.endsWith('.gguf'));
        file = PREFERRED_QUANTS.map((q) => ggufs.find((f) => f.toUpperCase().includes(q))).find(Boolean) ?? ggufs[0];
      } else {
        // 搜索响应无 siblings：用 HF tree API 列出仓库文件（返回 { type, path }[]）。
        // 注意 repo 的 / 不能整体 URL 编码（%2F 会被 hf-mirror 拒），需按段编码
        const treePath = repo.split('/').map(encodeURIComponent).join('/');
        const detail = execFileSync('curl.exe', ['-sL', '--max-time', '30', `${HF_MIRROR}/api/models/${treePath}/tree/main`], { encoding: 'utf8', windowsHide: true });
        const tree = JSON.parse(detail) as { type?: string; path?: string }[];
        const ggufs = (Array.isArray(tree) ? tree : [])
          .filter((e) => e.type === 'file' && e.path?.endsWith('.gguf'))
          .map((e) => e.path as string);
        if (ggufs.length === 0) {
          return { ok: false, error: `${repo} 没有 GGUF 文件` };
        }
        file = PREFERRED_QUANTS.map((q) => ggufs.find((f) => f.toUpperCase().includes(q))).find(Boolean) ?? ggufs[0];
      }
    } catch (err) {
      return { ok: false, error: `搜索模型失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!repo || !file) {
      return { ok: false, error: `模型解析失败: ${name}` };
    }
    return this.downloadFile(repo, file, modelsRoot);
  }

  /** 直链下载（支持 hf-mirror 或任意直链）。 */
  async downloadByUrl(url: string, modelsRoot: string): Promise<DownloadResult> {
    let repo = '';
    let file = '';
    try {
      const m = url.match(/hf-mirror\.com\/([^/]+\/[^/]+)\/resolve\/(?:main|refs\/main)\/([^?#]+)/);
      if (m) {
        repo = m[1];
        file = decodeURIComponent(m[2]);
      } else {
        file = basename(new URL(url).pathname);
        repo = file.replace(/\.gguf$/i, '');
      }
    } catch (err) {
      return { ok: false, error: `URL 解析失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!file) {
      return { ok: false, error: `无法从 URL 推断文件名: ${url}` };
    }
    return this.downloadFile(repo, file, modelsRoot);
  }

  private async downloadFile(repo: string, file: string, modelsRoot: string): Promise<DownloadResult> {
    const folderName = (basename(file).replace(/\.gguf$/i, '') || repo.split('/').pop() || 'model');
    const targetDir = join(modelsRoot, folderName);
    const target = join(targetDir, file);
    const url = `${HF_MIRROR}/${repo}/resolve/main/${encodeURIComponent(file)}?download=true`;
    const part = `${target}.part`;
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      return { ok: false, error: `创建目录失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    // 已存在且非 .part 残留则跳过
    if (existsSync(target)) {
      return { ok: true, path: target };
    }
    // 获取远端大小（取重定向链最后一个 Content-Length；过小视为校验页而非真实文件）
    let remoteSize = -1;
    try {
      const head = execFileSync('curl.exe', ['-sIL', '--max-time', '30', url], { encoding: 'utf8', windowsHide: true });
      const all = [...head.matchAll(/Content-Length:\s*(\d+)/gi)] as RegExpMatchArray[];
      const last = all.length > 0 ? Number(all[all.length - 1][1]) : -1;
      if (last > 1024 * 1024) remoteSize = last;
    } catch { /* 忽略，无法取到则跳过大小校验 */ }
    try {
      execFileSync('curl.exe', ['-L', '--fail', '--retry', '5', '--retry-delay', '3', '--connect-timeout', '20', '--max-time', '3600', '-C', '-', '-o', part, url], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch (err) {
      return { ok: false, error: `下载失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!existsSync(part)) {
      return { ok: false, error: '下载未产出文件' };
    }
    const size = statSync(part).size;
    if (remoteSize > 0 && size !== remoteSize) {
      return { ok: false, error: `文件大小不匹配（本地 ${size} 字节 ≠ 远端 ${remoteSize} 字节），请重试` };
    }
    try {
      renameSync(part, target);
    } catch (err) {
      return { ok: false, error: `落盘失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { ok: true, path: target };
  }
}
