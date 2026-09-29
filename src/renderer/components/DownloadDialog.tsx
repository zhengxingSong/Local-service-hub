import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { DownloadResult } from '../types';

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

interface Props {
  onClose: () => void;
  onDone: (result: DownloadResult) => void;
  onDownload: (req: { name?: string; url?: string; sha256?: string }) => Promise<DownloadResult>;
  onCancel: () => Promise<boolean>;
  onProgress: (cb: (payload: DownloadProgress) => void) => () => void;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * 模型下载对话框：支持按名称在 hf-mirror 搜索选型，或粘贴直链。
 * 下载期间显示进度并可取消；直链下载可额外提供 SHA256 做完整性校验。
 */
export function DownloadDialog({ onClose, onDone, onDownload, onCancel, onProgress }: Props) {
  const [mode, setMode] = useState<'name' | 'url'>('name');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onProgress((payload) => setProgress(payload)), [onProgress]);

  const start = async () => {
    setError(null);
    const req = mode === 'name'
      ? { name: name.trim(), sha256: sha256.trim() || undefined }
      : { url: url.trim(), sha256: sha256.trim() || undefined };
    if (mode === 'name' && !req.name) { setError('请输入模型名称'); return; }
    if (mode === 'url' && !req.url) { setError('请输入下载直链'); return; }
    if (sha256.trim() && !/^[0-9a-f]{64}$/i.test(sha256.trim())) { setError('SHA256 应为 64 位十六进制'); return; }
    setRunning(true);
    setProgress(null);
    try {
      const res = await onDownload(req);
      if (res.ok) {
        onDone(res);
      } else {
        setError(res.error ?? '下载失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const cancel = async () => {
    await onCancel();
    setRunning(false);
    setError('下载已取消');
  };

  const pct = progress && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
    : null;

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="modal" style={{ width: 560 }}>
        <div className="panel-head">
          <span className="panel-title"><Download size={15} /> 下载模型</span>
          <button className="btn small ghost" disabled={running} onClick={onClose}><X size={13} /></button>
        </div>

        <div className="cfg-tabs">
          <button className={`cfg-tab${mode === 'name' ? ' on' : ''}`} disabled={running} onClick={() => setMode('name')}>按名称搜索</button>
          <button className={`cfg-tab${mode === 'url' ? ' on' : ''}`} disabled={running} onClick={() => setMode('url')}>直链下载</button>
        </div>

        {mode === 'name' ? (
          <div className="form-row">
            <label>模型名称（在 hf-mirror 搜索 GGUF 仓库）</label>
            <input className="input" value={name} disabled={running} placeholder="例如 Qwen3-Reranker-0.6B" onChange={(e) => setName(e.target.value)} />
          </div>
        ) : (
          <div className="form-row">
            <label>下载直链（http/https，支持断点续传）</label>
            <input className="input" value={url} disabled={running} placeholder="https://hf-mirror.com/…/resolve/main/xxx.gguf" onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}

        <div className="form-row">
          <label>SHA256（可选，填写后强制校验完整性）</label>
          <input className="input" value={sha256} disabled={running} placeholder="64 位十六进制" onChange={(e) => setSha256(e.target.value)} />
        </div>

        {running && (
          <div className="progress-block">
            <div className="gpu-bar"><div className="gpu-fill" style={{ width: `${pct ?? 5}%` }} /></div>
            <div className="progress-meta">
              {progress
                ? `${formatSize(progress.receivedBytes)}${progress.totalBytes > 0 ? ` / ${formatSize(progress.totalBytes)} · ${pct}%` : ' · 总大小未知'}`
                : '正在解析远端文件…'}
            </div>
          </div>
        )}

        {error && <div className="banner error">{error}</div>}

        <div className="form-actions">
          {running
            ? <button className="btn danger" onClick={() => void cancel()}>取消下载</button>
            : <button className="btn ghost" onClick={onClose}>关闭</button>}
          <button className="btn primary" disabled={running} onClick={() => void start()}>
            {running ? '下载中…' : '开始下载'}
          </button>
        </div>
      </div>
    </div>
  );
}
