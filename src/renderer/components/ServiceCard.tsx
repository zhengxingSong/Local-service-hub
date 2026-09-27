import { Play, Square, RotateCw, FileText, Pencil, Trash2, Sparkles, HardDrive } from 'lucide-react';
import { ServiceView } from '../types';

const OV_ROLES = new Set(['vlm', 'embedding', 'intent']);

export function basename(path: string): string {
  const parts = path.replace(/[\\/]+/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${bytes} B`;
}

export function statusText(svc: ServiceView): string {
  if (svc.state === 'running') {
    if (svc.isCompose) return '容器运行中';
    if (svc.healthy) return '运行中';
    return '就绪中…';
  }
  switch (svc.state) {
    case 'stopped': return '已停止';
    case 'starting': return '启动中';
    case 'failed': return '失败';
    case 'restarting': return '重启中';
    default: return svc.state;
  }
}

export function dotClass(svc: ServiceView): string {
  if (svc.state === 'running') return svc.isCompose || svc.healthy ? 'dot-running' : 'dot-loading';
  if (svc.state === 'starting') return 'dot-loading';
  if (svc.state === 'restarting') return 'dot-restarting';
  if (svc.state === 'failed') return 'dot-failed';
  return 'dot-stopped';
}

export function vramText(svc: ServiceView): string {
  const mb = svc.vramActualMB ?? svc.vramEstimateMB;
  if (!mb) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

interface Props {
  svc: ServiceView;
  busy: boolean;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleAutostart: (id: string) => void;
  onOpenLog: (id: string) => void;
  onPromote?: (id: string) => void;
}

export function ServiceCard({ svc, busy, onStart, onStop, onRestart, onEdit, onDelete, onToggleAutostart, onOpenLog, onPromote }: Props) {
  const isActive = svc.state === 'running' || svc.state === 'starting' || svc.state === 'restarting';
  const isTrial = svc.id.startsWith('trial-');
  return (
    <div className={`card${svc.enabled ? '' : ' disabled'}${isTrial ? ' trial' : ''}`}>
      <div className="card-head">
        <div className="card-name">
          <span className={`dot ${dotClass(svc)}`} />
          <span className="card-label" title={svc.label}>{svc.label}</span>
          {isTrial && <span className="trial-badge"><Sparkles size={12} /> 体验</span>}
        </div>
        {svc.role && <span className={`role-badge${OV_ROLES.has(svc.role) ? '' : ' plain'}`}>{svc.role}</span>}
      </div>

      <div className="card-body">
        {svc.isCompose ? (
          <>
            <div className="field"><span className="k">Compose</span><span className="v">{basename(svc.composeDir)}</span></div>
            {svc.composeFile && <div className="field"><span className="k">文件</span><span className="v">{basename(svc.composeFile)}</span></div>}
            {svc.composeProfiles.length > 0 && <div className="field"><span className="k">配置</span><span className="v">{svc.composeProfiles.join(', ')}</span></div>}
          </>
        ) : svc.isCommand ? (
          <>
            <div className="field"><span className="k">命令</span><span className="v">{basename(svc.command)}</span></div>
            {svc.cwd && <div className="field"><span className="k">目录</span><span className="v">{svc.cwd}</span></div>}
          </>
        ) : (
          <>
            <div className="field"><span className="k">模型</span><span className="v">{basename(svc.model)}</span></div>
            <div className="field"><span className="k">alias</span><span className="v">{svc.alias}</span></div>
          </>
        )}
        <div className="field"><span className="k">端口</span><span className="v">{svc.port > 0 ? svc.port : '—'}</span></div>
        {(svc.vramEstimateMB !== null || svc.vramActualMB !== null) && (
          <div className="field"><span className="k"><HardDrive size={12} /> 显存</span><span className="v">{vramText(svc)}</span></div>
        )}
        <div className="field"><span className="k">重启</span><span className="v">{svc.restartCount} 次</span></div>
      </div>

      {svc.lastError && <div className="card-error">{svc.lastError}</div>}

      <label className="switch-row">
        <input type="checkbox" checked={svc.autostart} disabled={isTrial} onChange={() => onToggleAutostart(svc.id)} />
        <span>随应用启动 · {statusText(svc)}</span>
      </label>

      <div className="card-actions">
        {isTrial && onPromote ? (
          <button className="btn primary" disabled={busy} onClick={() => onPromote(svc.id)}>转正</button>
        ) : isActive ? (
          <button className="btn" disabled={busy} onClick={() => onStop(svc.id)}><Square size={14} /> 停止</button>
        ) : (
          <button className="btn primary" disabled={busy || !svc.enabled} onClick={() => onStart(svc.id)}><Play size={14} /> 启动</button>
        )}
        <button className="btn" disabled={busy || !isActive} onClick={() => onRestart(svc.id)}><RotateCw size={13} /> 重启</button>
        <button className="btn" disabled={busy} onClick={() => onOpenLog(svc.id)}><FileText size={13} /> 日志</button>
        <button className="btn ghost" disabled={busy} onClick={() => onEdit(svc.id)}><Pencil size={13} /> 编辑</button>
        <button className="btn danger" disabled={busy} onClick={() => onDelete(svc.id)}><Trash2 size={13} /> 删除</button>
      </div>
    </div>
  );
}