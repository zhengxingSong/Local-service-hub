import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { AppConfig, SnapshotInfo } from '../types';

interface Props {
  config: AppConfig;
  onSave: (cfg: AppConfig) => void;
  onCancel: () => void;
  /** 列出配置快照（最新的在前） */
  listSnapshots: () => Promise<SnapshotInfo[]>;
  /** 恢复某个快照；成功时返回恢复后的配置 */
  restoreSnapshot: (name: string) => Promise<{ ok: boolean; config?: AppConfig }>;
  /** 恢复成功后把新配置交回上层（并重载服务） */
  onRestored: (cfg: AppConfig) => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SettingsPanel({ config, onSave, onCancel, listSnapshots, restoreSnapshot, onRestored }: Props) {
  const [llamaServerPath, setLlamaServerPath] = useState(config.llamaServerPath);
  const [scanRootsText, setScanRootsText] = useState(config.scanRoots.join('\n'));
  const [modelsRoot, setModelsRoot] = useState(config.modelsRoot ?? '');
  const [showModelPanel, setShowModelPanel] = useState(config.showModelPanel !== false);
  const [maxRestarts, setMaxRestarts] = useState(String(config.maxRestarts));
  const [vramWarn, setVramWarn] = useState(String(config.vramWarnThreshold));
  const [autostartOnLogin, setAutostartOnLogin] = useState(config.autostartOnLogin);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [snapErr, setSnapErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshSnapshots = async () => {
    try {
      setSnapshots(await listSnapshots());
      setSnapErr(null);
    } catch (err) {
      setSnapErr(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => { void refreshSnapshots(); /* 打开时读一次即可 */ }, []);

  const save = () => {
    onSave({
      ...config,
      llamaServerPath: llamaServerPath.trim(),
      scanRoots: scanRootsText.split('\n').map((s) => s.trim()).filter(Boolean),
      modelsRoot: modelsRoot.trim(),
      showModelPanel,
      maxRestarts: parseInt(maxRestarts, 10) || 0,
      vramWarnThreshold: parseInt(vramWarn, 10) || 90,
      autostartOnLogin,
    });
  };

  const restore = async (snap: SnapshotInfo) => {
    const when = fmtTime(snap.createdAt);
    if (!window.confirm(
      `恢复到 ${when} 的快照？\n\n` +
      `当前配置会被覆盖，但覆盖前会自动再存一份（所以这一步可逆）。\n` +
      `恢复后正在运行、但新配置里不存在的服务会被停止。`,
    )) return;
    setBusy(true);
    try {
      const res = await restoreSnapshot(snap.name);
      if (!res.ok || !res.config) {
        setSnapErr('恢复失败：快照不存在或不可读');
      } else {
        onRestored(res.config);
        await refreshSnapshots();
      }
    } catch (err) {
      setSnapErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const llamaConfigured = Boolean(llamaServerPath.trim() || scanRootsText.trim());

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal">
        <div className="panel-head">
          <span className="panel-title">全局设置</span>
          <button className="btn small ghost" onClick={onCancel}>关闭</button>
        </div>

        <div className="sec-h"><span className="sec-no">①</span> 能力</div>
        <div className="form-row">
          <label>llama-server.exe 路径（可选）</label>
          <input className="input" value={llamaServerPath} onChange={(e) => setLlamaServerPath(e.target.value)} placeholder="留空则不使用 llama 能力" />
          <span className="hint">仅 llama 模板服务需要；自定义命令与 Compose 服务不需要</span>
        </div>

        <div className="form-row">
          <label>模型扫描根目录（每行一个，可选）</label>
          <textarea className="textarea" rows={3} value={scanRootsText} onChange={(e) => setScanRootsText(e.target.value)} placeholder="例如 D:\LLM Model" />
          <span className="hint">用于发现 *.gguf 与关联 mmproj；留空则不扫描模型</span>
        </div>

        <div className="form-row">
          <label>模型下载目录（可选）</label>
          <input className="input" value={modelsRoot} onChange={(e) => setModelsRoot(e.target.value)} placeholder="留空时使用「扫描根目录\llama.cpp\models」" />
        </div>

        <div className="sec-h"><span className="sec-no">②</span> 运行</div>
        <div className="form-row">
          <label>界面</label>
          <label className="check-row">
            <input type="checkbox" checked={showModelPanel} disabled={!llamaConfigured} onChange={(e) => setShowModelPanel(e.target.checked)} />
            显示 llama 模型库面板（模型扫描 / 一键体验 / 显存估算）
          </label>
          {!llamaConfigured && <span className="hint">未配置 llama-server 路径与扫描根目录，模型面板不会出现</span>}
        </div>

        <div className="form-row-group">
          <div className="form-row">
            <label>崩溃重启上限</label>
            <input className="input" type="number" min={0} value={maxRestarts} onChange={(e) => setMaxRestarts(e.target.value)} />
          </div>
          <div className="form-row">
            <label>显存警告阈值 %</label>
            <input className="input" type="number" min={1} max={100} value={vramWarn} onChange={(e) => setVramWarn(e.target.value)} />
          </div>
        </div>

        <label className="check-row">
          <input type="checkbox" checked={autostartOnLogin} onChange={(e) => setAutostartOnLogin(e.target.checked)} />
          随 Windows 登录自动启动应用
        </label>

        <div className="sec-h">
          <span className="sec-no">③</span> 配置快照
          <span className="sec-note">改动前自动生成 · 保留最近 10 份</span>
        </div>
        {snapErr && <div className="banner error">{snapErr}</div>}
        {snapshots.length === 0 ? (
          <span className="hint">还没有快照。第一次保存设置或服务后会自动生成。</span>
        ) : (
          <table className="cfg-table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>时间</th>
                <th style={{ width: 120 }}>原因</th>
                <th style={{ width: 90 }}>大小</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.name}>
                  <td><span className="cfg-mono">{fmtTime(s.createdAt)}</span></td>
                  <td>{s.reason}</td>
                  <td><span className="cfg-mono">{(s.sizeBytes / 1024).toFixed(1)} KB</span></td>
                  <td>
                    <button className="btn small" disabled={busy} onClick={() => void restore(s)}>
                      <RotateCcw size={13} /> 恢复
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <span className="hint">
          快照是「改坏了能退回去」的退路，不是备份系统：它只保留配置文件本身，
          不含模型文件与日志。恢复前会自动再存一份当前配置，因此恢复本身也可逆。
        </span>

        <div className="form-actions">
          <button className="btn ghost" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
