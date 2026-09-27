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
  const [modelsRoot, setModelsRoot] = useState(config.modelsRoot ?? '');
  const [showModelPanel, setShowModelPanel] = useState(config.showModelPanel !== false);
  const [maxRestarts, setMaxRestarts] = useState(String(config.maxRestarts));
  const [vramWarn, setVramWarn] = useState(String(config.vramWarnThreshold));
  const [autostartOnLogin, setAutostartOnLogin] = useState(config.autostartOnLogin);

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

  const llamaConfigured = Boolean(llamaServerPath.trim() || scanRootsText.trim());

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal">
        <div className="panel-head">
          <span className="panel-title">全局设置</span>
          <button className="btn small ghost" onClick={onCancel}>关闭</button>
        </div>

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

        <div className="form-actions">
          <button className="btn ghost" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
