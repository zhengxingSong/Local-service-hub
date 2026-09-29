import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, X } from 'lucide-react';
import { AppConfig, RunRecord, ServiceView } from '../types';
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
  listRuns: (serviceId?: string, limit?: number) => Promise<RunRecord[]>;
  clearRuns: (serviceId?: string) => Promise<number>;
}

const OUTCOME_LABEL: Record<RunRecord['outcome'], string> = {
  running: '进行中',
  stopped: '已停止',
  failed: '失败',
};

/** 运行时长；没有结束时间时不编造，如实说明。 */
function runDuration(r: RunRecord): string {
  if (!r.endedAt) return '—';
  const a = Date.parse(r.startedAt);
  const b = Date.parse(r.endedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return '—';
  const ms = Math.max(0, b - a);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`;
  return `${(ms / 3600000).toFixed(1)} 小时`;
}

function readyLabel(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} 秒`;
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
  svc, config, portOwners, busy, onClose, onFix, getLog, clearLog, openLogDir, listRuns, clearRuns,
}: Props) {
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const d = diagnose({ svc, config, portOwners });

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await listRuns(svc.id, 20));
    } catch {
      setRuns([]);
    }
  }, [listRuns, svc.id]);

  useEffect(() => { void refreshRuns(); }, [refreshRuns]);

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

          {/* 3. 运行记录：抽屉里的"一直怎么样"，与归因的"这一次为什么"互补 */}
          <div className="drawer-sec">
            <div className="drawer-sec-h">
              运行记录
              <span className="list-spacer" />
              <button className="btn small ghost" title="刷新" onClick={() => void refreshRuns()}><RefreshCw size={13} /></button>
              <button className="btn small ghost" disabled={busy} onClick={() => void clearRuns(svc.id).then(() => refreshRuns())}>清空</button>
            </div>
            {runs.length === 0 ? (
              <div className="hint">还没有运行记录。每次启动都会在这里留下一条。</div>
            ) : (
              <table className="cfg-table">
                <thead>
                  <tr>
                    <th>开始</th><th style={{ width: 78 }}>时长</th><th style={{ width: 68 }}>就绪</th>
                    <th style={{ width: 62 }}>结果</th><th style={{ width: 54 }}>退出码</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td><span className="cfg-mono">{fmtTime(r.startedAt)}</span></td>
                      <td><span className="cfg-mono">{runDuration(r)}</span></td>
                      <td><span className="cfg-mono">{readyLabel(r.readyMs)}</span></td>
                      <td><span className={`runout ${r.outcome}`}>{OUTCOME_LABEL[r.outcome]}</span></td>
                      <td><span className="cfg-mono">{r.returncode ?? '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <span className="hint">
              就绪耗时能看出模型是不是越起越慢；退出码与结果能区分"没起来"和"跑着崩了"。
              上次应用退出时还在运行的记录，结束时间留空——无法知道它究竟何时停的。
            </span>
          </div>

          {/* 4. 日志 */}
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
