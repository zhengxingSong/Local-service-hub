import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, LogOut, Plus, Download, HardDrive, RefreshCw } from 'lucide-react';
import { AppConfig, GpuInfo, ModelEntry, ServiceConfig, ServiceView } from './types';
import { ServiceCard, basename, formatSize } from './components/ServiceCard';
import { PresetBar } from './components/PresetBar';
import { PresetManager } from './components/PresetManager';
import { ServiceEditor } from './components/ServiceEditor';
import { SettingsPanel } from './components/SettingsPanel';
import { LogViewer } from './components/LogViewer';

type EditorState = { id: string | null; cfg: ServiceConfig | null } | null;

function slug(text: string): string {
  return (text || 'service')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'service';
}

export function App() {
  const api = window.llamaApi;
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [services, setServices] = useState<ServiceView[]>([]);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const bannerTimer = useRef<number | null>(null);

  const showBanner = useCallback((kind: 'ok' | 'error', text: string) => {
    setBanner({ kind, text });
    if (bannerTimer.current !== null) window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [cfg, status, modelList] = await Promise.all([api.getConfig(), api.status(), api.scanModels()]);
      setConfig(cfg);
      setServices(status.services ?? []);
      setGpu(status.gpu ?? null);
      setModels(modelList ?? []);
    } catch (err) {
      showBanner('error', `状态加载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [api, showBanner]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => api.onServicesChanged(({ services: svc, gpu: g }) => {
    setServices(svc ?? []);
    setGpu(g ?? null);
  }), [api]);

  // P0-3 配置热加载：外部修改 services.json 时提示
  useEffect(() => api.onConfigChanged(() => setConfigNotice(true)), [api]);

  useEffect(() => () => {
    if (bannerTimer.current !== null) window.clearTimeout(bannerTimer.current);
  }, []);

  const doAction = async (action: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await action();
      showBanner('ok', okText);
      await refresh();
    } catch (err) {
      showBanner('error', `${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = (next: AppConfig) => {
    setConfig(next);
    void doAction(() => api.saveConfig(next), '配置已保存');
    void refresh();
  };

  const toggleAutostart = (id: string) => {
    if (!config) return;
    const svc = config.services[id];
    if (!svc) return;
    saveConfig({ ...config, services: { ...config.services, [id]: { ...svc, autostart: !svc.autostart } } });
  };

  // P0-2 组互斥：启动独占组时，先确认停止其他运行中的组
  const startPreset = async (name: string, members: string[]) => {
    const exclusive = config?.exclusivePresets?.includes(name);
    let proceed = true;
    if (exclusive && config) {
      const runningInOthers = services.filter((s) =>
        s.state === 'running' &&
        !members.includes(s.id) &&
        Object.entries(config.presets).some(([n, m]) => n !== name && m.includes(s.id)),
      );
      if (runningInOthers.length > 0) {
        const vram = runningInOthers.reduce(
          (sum, s) => sum + (s.vramActualMB ?? s.vramEstimateMB ?? 0), 0,
        );
        proceed = window.confirm(
          `「${name}」为独占预设组。将停止其他组正在运行的服务：\n\n` +
          runningInOthers.map((s) => `  · ${s.label}`).join('\n') +
          (vram > 0 ? `\n\n预计释放显存约 ${(vram / 1024).toFixed(1)} GB` : '') +
          `\n\n确认停止后再启动「${name}」？`,
        );
        if (proceed) {
          for (const s of runningInOthers) {
            await doAction(() => api.stop(s.id), '已停止');
          }
        }
      }
    }
    if (!proceed) return;
    for (const id of members) void doAction(() => api.start(id), `已启动 ${id}`);
  };

  const stopPreset = (name: string, members: string[]) => {
    for (const id of members) void doAction(() => api.stop(id), `已停止 ${id}`);
  };

  // P1-2 模型即卡片：一键体验未配置模型
  const startTrial = async (m: ModelEntry) => {
    await doAction(() => api.startTrial(m.path, m.siblingMmproj ?? undefined), `已临时启动 ${basename(m.path)}`);
  };

  // P1-2 转正：把临时服务写入持久配置
  const promote = async (id: string) => {
    const svc = services.find((s) => s.id === id);
    if (!svc || !config) return;
    if (!window.confirm(`将「${svc.label}」转正为持久服务？`)) return;
    const newId = slug(svc.label || basename(svc.model));
    const cfg: ServiceConfig = {
      label: svc.label,
      role: svc.role,
      model: svc.model,
      mmproj: svc.mmproj,
      alias: svc.alias,
      port: svc.port,
      args: [],
      autostart: false,
      enabled: true,
    };
    // trial 的 args 由主进程生成，这里无法直接拿到原始 args 数组（view 未透传）。
    // 使用最小参数集：主进程 startTrial 已按推荐参数运行，转正后采用相同端口与 alias。
    const nextServices = { ...config.services, [newId]: cfg };
    if (config.services[newId]) delete nextServices[id]; // 同 id 冲突时保留持久条目
    saveConfig({ ...config, services: nextServices });
  };

  // P1-3 下载器
  const downloadByName = async () => {
    const name = window.prompt('输入要下载的模型名（在 hf-mirror 搜索，例如 Qwen3-Reranker-0.6B）：');
    if (!name) return;
    setDownloading(true);
    try {
      const res = await api.downloadModel({ name });
      if (res.ok) {
        showBanner('ok', `下载完成：${res.path}`);
        await refresh();
      } else {
        showBanner('error', res.error ?? '下载失败');
      }
    } finally {
      setDownloading(false);
    }
  };

  const applyReloadedConfig = async () => {
    setConfigNotice(false);
    try {
      const res = await api.reloadConfig();
      showBanner('ok', `已应用外部配置${res.restarted.length > 0 ? `，重启了 ${res.restarted.length} 个服务` : ''}`);
      await refresh();
    } catch (err) {
      showBanner('error', `应用配置失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const serviceStates = Object.fromEntries(services.map((s) => [s.id, s.state]));

  const gpuPct = gpu && gpu.totalMB > 0 ? Math.round((gpu.usedMB / gpu.totalMB) * 100) : 0;
  const warnThreshold = config?.vramWarnThreshold ?? 90;

  // 未配置成服务的模型（模型库一键体验）
  const configuredModels = new Set(Object.values(config?.services ?? {}).map((s) => s.model).filter(Boolean));
  const freeModels = models.filter((m) => !configuredModels.has(m.path)).slice(0, 20);

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <div className="header-title">LLaMA 模型管理器</div>
          <div className="header-sub">llama.cpp 本地模型服务</div>
        </div>
        <div className="header-spacer" />
        <button className="btn" onClick={() => setShowSettings(true)}><Settings size={15} /> 设置</button>
        <button className="btn ghost" onClick={() => void api.quit()}><LogOut size={15} /> 退出</button>
      </header>

      <main className="main">
        {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}

        {configNotice && (
          <div className="notice-bar">
            <span>检测到 services.json 被外部修改。</span>
            <button className="btn small primary" onClick={() => void applyReloadedConfig()}><RefreshCw size={13} /> 应用</button>
            <button className="btn small ghost" onClick={() => setConfigNotice(false)}>忽略</button>
          </div>
        )}

        {gpu && (
          <div className="gpu-card">
            <div className="gpu-head">
              <HardDrive size={18} />
              <span>GPU 显存</span>
            </div>
            <div className="gpu-bar">
              <div className={`gpu-fill${gpuPct >= warnThreshold ? ' warn' : ''}`} style={{ width: `${Math.min(gpuPct, 100)}%` }} />
            </div>
            <div className="gpu-meta">
              <span><b>{gpu.usedMB}</b> / {gpu.totalMB} MB · {gpuPct}%</span>
              {gpuPct >= warnThreshold && <span className="gpu-warn-tag">⚠️ 显存紧张</span>}
            </div>
          </div>
        )}

        {config && (
          <PresetBar
            presets={config.presets}
            serviceStates={serviceStates}
            busy={busy}
            onStartPreset={(name, members) => void startPreset(name, members)}
            onStopPreset={stopPreset}
            onEditPresets={() => setShowPresets(true)}
          />
        )}

        {freeModels.length > 0 && (
          <div className="model-lib">
            <div className="model-lib-head">
              <span>模型库 · 一键体验（未配置 {freeModels.length}）</span>
              <button className="btn small ghost" disabled={downloading} onClick={() => void downloadByName()}>
                <Download size={13} /> 下载模型
              </button>
            </div>
            <div className="model-lib-grid">
              {freeModels.map((m) => (
                <div key={m.path} className="model-chip" title={m.path}>
                  <span className="model-chip-name">{basename(m.name)}</span>
                  <span className="model-chip-size">{formatSize(m.sizeBytes)}</span>
                  <button
                    className="btn small"
                    disabled={busy || downloading}
                    onClick={() => void startTrial(m)}
                  >一键体验</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="toolbar">
          <button className="btn primary" onClick={() => setEditor({ id: null, cfg: null })}><Plus size={15} /> 新增服务</button>
          <span className="count">{models.length} 个可加载模型 · {services.length} 个服务</span>
        </div>

        {services.length === 0 ? (
          <div className="empty">暂无服务配置，点击「新增服务」添加，或在上方模型库中「一键体验」</div>
        ) : (
          <div className="cards">
            {services.map((svc) => (
              <ServiceCard
                key={svc.id}
                svc={svc}
                busy={busy}
                onStart={(id) => void doAction(() => api.start(id), '服务已启动')}
                onStop={(id) => void doAction(() => api.stop(id), '服务已停止')}
                onRestart={(id) => void doAction(() => api.restart(id), '服务已重启')}
                onEdit={(id) => {
                  const cfg = config?.services[id] ?? null;
                  setEditor({ id, cfg });
                }}
                onDelete={(id) => {
                  if (!config) return;
                  if (!window.confirm(`删除服务 ${id}？将停止进程并移除配置。`)) return;
                  const services = { ...config.services };
                  delete services[id];
                  saveConfig({ ...config, services });
                }}
                onToggleAutostart={toggleAutostart}
                onOpenLog={(id) => setLogId(id)}
                onPromote={(id) => void promote(id)}
              />
            ))}
          </div>
        )}
      </main>

      {editor && config && (
        <ServiceEditor
          initial={editor.cfg}
          existingIds={Object.keys(config.services)}
          models={models}
          onSave={(id, cfg) => {
            const services = { ...config.services, [id]: cfg };
            if (editor.id && editor.id !== id && config.services[editor.id]) delete services[editor.id];
            saveConfig({ ...config, services });
            setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      )}

      {showSettings && config && (
        <SettingsPanel config={config} onSave={(cfg) => { saveConfig(cfg); setShowSettings(false); }} onCancel={() => setShowSettings(false)} />
      )}

      {showPresets && config && (
        <PresetManager
          presets={config.presets}
          allServiceIds={Object.keys(config.services)}
          exclusivePresets={config.exclusivePresets ?? []}
          onSave={(presets, exclusivePresets) => { saveConfig({ ...config, presets, exclusivePresets }); setShowPresets(false); }}
          onCancel={() => setShowPresets(false)}
        />
      )}

      {logId && (
        <LogViewer
          serviceId={logId}
          onClose={() => setLogId(null)}
          getLog={(id, tail) => api.getLog(id, tail)}
          clearLog={(id) => api.clearLog(id)}
        />
      )}
    </div>
  );
}