import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, X } from 'lucide-react';
import { AppConfig, ServiceView } from '../types';
import { diagnose, Fix } from '../diagnose';
import { dotClass, formatMB, stateLabel } from './PurposeCard';

interface Props {
  svc: ServiceView;
  config: AppConfig;
  portOwners: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onFix: (fix: Fix) => void;
  getLog: (id: string, tail?: number) => Promise<string>;
  clearLog: (id: string) => Promise<boolean>;
  openLogDir: () => Promise<boolean>;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const CONF_LABEL = { high: '证据明确', medium: '按时长推断', low: '证据不足' } as const;

/**
 * 处置抽屉：一个服务的运行时全貌。
 *
 * 顺序是固定的：**状态 → 归因 → 修正动作 → 日志**。
 * 日志放最后不是因为它不重要，而是因为"先看结论再翻日志"比反过来快得多；
 * 但它必须同屏可达——否则归因就成了无法核对的断言。
 */
export function ServiceDrawer({
  svc, config, portOwners, busy, onClose, onFix, getLog, clearLog, openLogDir,
}: Props) {
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const d = diagnose({ svc, config, portOwners });

  const refresh = useCallback(async () => {
    try {
      setLog(await getLog(svc.id, 16000));
    } catch {
      setLog('读取日志失败');
    } finally {
      setLoading(false);
    }
  }, [getLog, svc.id]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div className="drawer-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer">
        <div className="drawer-h">
          <span className={`dot ${dotClass(svc)}`} />
          <span className="drawer-title">{svc.label || svc.id}</span>
          <span className="cfg-flag">{stateLabel(svc)}</span>
          <span className="list-spacer" />
          <button className="btn small ghost" onClick={onClose} title="关闭"><X size={14} /></button>
        </div>

        <div className="drawer-body">
          {/* 1. 状态 */}
          <div className="drawer-sec">
            <div className="drawer-sec-h">状态</div>
            <div className="kv">
              <span className="k">进程</span><span className="v">{svc.pid ?? '—'}</span>
              <span className="k">端口</span><span className="v">{svc.port || '—'}{svc.listening ? '（在监听）' : ''}</span>
              <span className="k">别名</span><span className="v">{svc.alias || '—'}</span>
              <span className="k">显存</span>
              <span className="v">
                {formatMB(svc.vramActualMB ?? svc.vramEstimateMB)}
                {svc.vramActualMB ? '（实测）' : svc.vramEstimateMB ? '（推算）' : ''}
              </span>
              <span className="k">启动于</span><span className="v">{fmtTime(svc.startedAt)}</span>
              <span className="k">结束于</span><span className="v">{fmtTime(svc.endedAt)}</span>
              <span className="k">退出码</span><span className="v">{svc.returncode ?? '—'}</span>
              <span className="k">重启</span><span className="v">{svc.restartCount} 次{config.maxRestarts ? ` / 上限 ${config.maxRestarts}` : ''}</span>
            </div>
          </div>

          {/* 2. 归因 */}
          <div className="drawer-sec">
            <div className="drawer-sec-h">
              归因
              <span className={`conf conf-${d.confidence}`}>{CONF_LABEL[d.confidence]}</span>
            </div>
            <div className={`diag diag-${d.cause}`}>{d.title}</div>
            <div className="drawer-ev">
              {d.evidence.map((e, i) => <div className="ev-line" key={i}>{e}</div>)}
            </div>
            <div className="drawer-acts">
              {d.actions.map((f, i) => (
                <button
                  key={i}
                  className={`btn small${f.id === 'retry' ? ' primary' : ''}`}
                  disabled={busy}
                  onClick={() => onFix(f)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. 日志 */}
          <div className="drawer-sec">
            <div className="drawer-sec-h">
              日志
              <span className="list-spacer" />
              <button className="btn small ghost" onClick={() => void openLogDir()}><FolderOpen size={13} /> 目录</button>
              <button className="btn small ghost" disabled={busy} onClick={() => void clearLog(svc.id).then(() => setLog(''))}>清空</button>
              <button className="btn small ghost" onClick={() => void refresh()}><RefreshCw size={13} /></button>
            </div>
            {loading ? (
              <div className="loading-text">加载中…</div>
            ) : (
              <div className="log-viewer" ref={boxRef}>{log || '（暂无日志）'}</div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
