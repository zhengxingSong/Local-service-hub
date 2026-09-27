import { useState } from 'react';
import { AppConfig } from '../types';

interface Props {
  config: AppConfig;
  onSave: (cfg: AppConfig) => void;
  onCancel: () => void;
}

export function SettingsPanel({ config, onSave, onCancel }: Props) {
  const [llamaServerPath, setLlamaServerPath] = useState(config.llamaServerPath);
  const [scanRootsText, setScanRootsText] = useState(config.scanRoots.join('\n'));
  const [maxRestarts, setMaxRestarts] = useState(String(config.maxRestarts));
  const [vramWarn, setVramWarn] = useState(String(config.vramWarnThreshold));
  const [autostartOnLogin, setAutostartOnLogin] = useState(config.autostartOnLogin);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!llamaServerPath.trim()) { setError('llama-server 路径不能为空'); return; }
    onSave({
      ...config,
      llamaServerPath: llamaServerPath.trim(),
      scanRoots: scanRootsText.split('\n').map((s) => s.trim()).filter(Boolean),
      maxRestarts: parseInt(maxRestarts, 10) || 0,
      vramWarnThreshold: parseInt(vramWarn, 10) || 90,
      autostartOnLogin,
    });
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal">
        <div className="panel-head">
          <span className="panel-title">全局设置</span>
          <button className="btn small ghost" onClick={onCancel}>关闭</button>
        </div>

        <div className="form-row">
          <label>llama-server.exe 路径</label>
          <input className="input" value={llamaServerPath} onChange={(e) => setLlamaServerPath(e.target.value)} />
        </div>

        <div className="form-row">
          <label>模型扫描根目录（每行一个）</label>
          <textarea className="textarea" rows={3} value={scanRootsText} onChange={(e) => setScanRootsText(e.target.value)} />
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

        {error && <div className="banner error">{error}</div>}

        <div className="form-actions">
          <button className="btn ghost" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
