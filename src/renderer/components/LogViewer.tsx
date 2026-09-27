import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  serviceId: string;
  onClose: () => void;
  getLog: (id: string, tail?: number) => Promise<string>;
  clearLog: (id: string) => Promise<boolean>;
}

export function LogViewer({ serviceId, onClose, getLog, clearLog }: Props) {
  const [log, setLog] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const text = await getLog(serviceId, 16000);
      setLog(text);
    } catch {
      setLog('读取日志失败');
    } finally {
      setLoading(false);
    }
  }, [getLog, serviceId]);

  useEffect(() => {
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
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 680 }}>
        <div className="panel-head">
          <span className="panel-title">日志 · {serviceId}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn small" onClick={() => void clearLog(serviceId).then(() => setLog(''))}>清空</button>
            <button className="btn small ghost" onClick={onClose}>关闭</button>
          </div>
        </div>
        {loading ? (
          <div className="loading-text">加载中…</div>
        ) : (
          <div className="log-viewer" ref={boxRef}>{log || '（暂无日志）'}</div>
        )}
      </div>
    </div>
  );
}
