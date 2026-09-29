import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, LogOut, Plus, Download, RefreshCw } from 'lucide-react';
import { AppConfig, DownloadResult, GpuInfo, ModelEntry, ServiceConfig, ServiceView } from './types';
import { ServiceCard, basename, formatSize } from './components/ServiceCard';
import { PurposeCard } from './components/PurposeCard';
import { ResourceLedger } from './components/ResourceLedger';
import { PresetManager } from './components/PresetManager';
import { ServiceEditor } from './components/ServiceEditor';
import { SettingsPanel } from './components/SettingsPanel';
import { LogViewer } from './components/LogViewer';
import { DownloadDialog } from './components/DownloadDialog';

type EditorState = { id: string | null; cfg: ServiceConfig | null } | null;

/** 状态轮询间隔：状态变更还会由主进程主动推送，这里只做兜底与显存刷新 */
const POLL_INTERVAL_MS = 5000;
const MODEL_PAGE_SIZE = 20;

export function App() {
  const api = window.serviceHubApi;
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [services, setServices] = useState<ServiceView[]>([]);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState(false);
  const [modelVisible, setModelVisible] = useState(MODEL_PAGE_SIZE);
  const bannerTimer = useRef<number | null>(null);

  const showBanner = useCallback((kind: 'ok' | 'error', text: string) => {
    setBanner({ kind, text });
    if (bannerTimer.current !== null) window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [cfg, status] = await Promise.all([api.getConfig(), api.status()]);
      setConfig(cfg);
      setServices(status.services ?? []);
      setGpu(status.gpu ?? null);
    } catch (err) {
      showBanner('error', `状态加载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [api, showBanner]);

  // llama 能力是否可用：配置了 llama-server 或扫描根目录之一即认为使用 llama
  const llamaConfigured = Boolean(config && (config.llamaServerPath || (config.scanRoots?.length ?? 0) > 0));
  const showModelPanel = Boolean(config && config.showModelPanel !== false && llamaConfigured);
  const scanRootsKey = (config?.scanRoots ?? []).join('|');

  const refreshModels = useCallback(async (force = false) => {
    if (!api) return;
    try {
      setModels((await api.scanModels({ force })) as ModelEntry[]);
    } catch { /* 扫描失败保留上一次结果 */ }
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // 模型扫描独立于状态轮询：主进程按 10 秒缓存，避免每次刷新都全盘遍历
  useEffect(() => {
    if (!llamaConfigured) {
      setModels([]);
      return;
    }
    void refreshModels();
  }, [llamaConfigured, scanRootsKey, refreshModels]);

  useEffect(() => api.onServicesChanged(({ services: svc, gpu: g }) => {
    setServices(svc ?? []);
    setGpu(g ?? null);
  }), [api]);

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
      showBanner('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = (next: AppConfig) => {
    setConfig(next);
    void doAction(() => api.saveConfig(next), '配置已保存');
  };

  const toggleAutostart = (id: string) => {
    if (!config) return;
    const svc = config.services[id];
    if (!svc) return;
    saveConfig({ ...config, services: { ...config.services, [id]: { ...svc, autostart: !svc.autostart } } });
  };

  // 组互斥：启动独占组时，先确认停止其他运行中的组
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

  /** 重启整组：先逆序停止运行中的成员，再按成员顺序启动 */
  const restartPreset = async (members: string[]) => {
    for (const s of [...services].reverse()) {
      if (members.includes(s.id) && s.state === 'running') {
        await doAction(() => api.stop(s.id), `已停止 ${s.id}`);
      }
    }
    for (const id of members) void doAction(() => api.start(id), `已启动 ${id}`);
  };

  /** 解散组：只解除组合关系，不删除任何服务 */
  const dissolvePreset = (name: string) => {
    if (!config) return;
    if (!window.confirm(`解散预设组「${name}」？\n\n只解除组合关系，不会删除任何服务。`)) return;
    const presets = { ...config.presets };
    delete presets[name];
    saveConfig({
      ...config,
      presets,
      exclusivePresets: (config.exclusivePresets ?? []).filter((n) => n !== name),
    });
  };

  const startTrial = async (m: ModelEntry) => {
    await doAction(() => api.startTrial(m.path, m.siblingMmproj ?? undefined), `已临时启动 ${basename(m.path)}`);
  };

  /** 转正：主进程用体验服务的完整参数写入持久配置并启动，避免丢失启动参数 */
  const promote = async (id: string) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    if (!window.confirm(`将「${svc.label}」转正为持久服务？将使用与体验时相同的启动参数。`)) return;
    setBusy(true);
    try {
      const next = await api.promote({ trialId: id }) as AppConfig;
      setConfig(next);
      showBanner('ok', `已转正为持久服务：${svc.label}`);
      await refresh();
    } catch (err) {
      showBanner('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const dropTrial = async (id: string) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    if (!window.confirm(`停止并移除体验服务「${svc.label}」？`)) return;
    await doAction(() => api.dropTrial(id), '已移除体验服务');
  };

  const onDownloadDone = async (res: DownloadResult) => {
    setShowDownload(false);
    showBanner('ok', `下载完成${res.sha256Verified ? '（SHA256 校验通过）' : ''}：${res.path ?? ''}`);
    await refreshModels(true);
    await refresh();
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

  const warnThreshold = config?.vramWarnThreshold ?? 90;

  // 未配置成服务的模型（模型库一键体验）
  const configuredModels = new Set(Object.values(config?.services ?? {}).map((s) => s.model).filter(Boolean));
  const freeModels = models.filter((m) => !configuredModels.has(m.path));

  // 用途卡分组：一个预设组 = 一个用途；未分组服务各自成为一个单成员用途
  const byId: Record<string, ServiceView> = Object.fromEntries(services.map((s) => [s.id, s]));
  const presetEntries = Object.entries(config?.presets ?? {});
  const groupedIds = new Set(presetEntries.flatMap(([, ids]) => ids));
  const ungrouped = services.filter((s) => !groupedIds.has(s.id));

  // 共用提示：某个成员同时被其它「正在运行的用途」包含，停组时要说清
  const runningPresetNames = presetEntries
    .filter(([, ids]) => ids.some((id) => byId[id]?.state === 'running'))
    .map(([n]) => n);
  const sharedWith: Record<string, string[]> = {};
  for (const [name, ids] of presetEntries) {
    for (const id of ids) {
      const others = runningPresetNames.filter(
        (n) => n !== name && (config?.presets[n] ?? []).includes(id),
      );
      if (others.length > 0) sharedWith[id] = others;
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <div className="header-title">服务中枢</div>
          <div className="header-sub">本机服务 · 进程 · 容器</div>
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

        {showModelPanel && (
          <div className="model-lib">
            <div className="model-lib-head">
              <span>llama 模型库 · 一键体验（未配置 {freeModels.length}）</span>
              <div className="model-lib-actions">
                <button className="btn small ghost" onClick={() => void refreshModels(true)}><RefreshCw size={13} /> 刷新</button>
                <button className="btn small ghost" onClick={() => setShowDownload(true)}><Download size={13} /> 下载模型</button>
              </div>
            </div>
            <div className="model-lib-grid">
              {freeModels.slice(0, modelVisible).map((m) => (
                <div key={m.path} className="model-chip" title={m.path}>
                  <span className="model-chip-name">{basename(m.name)}</span>
                  <span className="model-chip-size">{formatSize(m.sizeBytes)}</span>
                  <button className="btn small" disabled={busy} onClick={() => void startTrial(m)}>一键体验</button>
                </div>
              ))}
            </div>
            {freeModels.length > modelVisible && (
              <button className="btn small ghost model-more" onClick={() => setModelVisible((n) => n + MODEL_PAGE_SIZE)}>
                显示更多（还有 {freeModels.length - modelVisible} 个）
              </button>
            )}
          </div>
        )}

        <div className="run-grid">
          <div className="run-main">
            <div className="list-head">
              <span className="list-title">用途</span>
              <span className="count">
                {services.length} 个服务 · {presetEntries.length + ungrouped.length} 个用途
                {showModelPanel && ` · ${models.length} 个可加载模型`}
              </span>
              <span className="list-spacer" />
              <button className="btn small ghost" onClick={() => setEditor({ id: null, cfg: null })}>
                <Plus size={14} /> 新增服务
              </button>
            </div>

            {services.length === 0 && (
              <div className="empty">
                暂无服务。点击「新增服务」添加 llama.cpp 模型服务、任意命令进程或 Docker Compose 容器栈。
              </div>
            )}

            {presetEntries.map(([name, ids]) => {
              const members = ids.map((id) => byId[id]).filter((s): s is ServiceView => Boolean(s));
              if (members.length === 0) return null;
              return (
                <PurposeCard
                  key={name}
                  name={name}
                  members={members}
                  exclusive={(config?.exclusivePresets ?? []).includes(name)}
                  sharedWith={sharedWith}
                  busy={busy}
                  onEnable={() => void startPreset(name, ids)}
                  onDisable={() => stopPreset(name, ids)}
                  onRestartAll={() => void restartPreset(ids)}
                  onEditGroup={() => setShowPresets(true)}
                  onDissolve={() => dissolvePreset(name)}
                  onStartMember={(id) => void doAction(() => api.start(id), '服务已启动')}
                  onStopMember={(id) => void doAction(() => api.stop(id), '服务已停止')}
                  onDetail={(id) => setLogId(id)}
                />
              );
            })}

            {ungrouped.length > 0 && (
              <>
                <div className="list-sub">未分组服务 · 各自成为一个用途（{ungrouped.length}）</div>
                <div className="cards">
                  {ungrouped.map((svc) => (
                    <ServiceCard
                      key={svc.id}
                      svc={svc}
                      busy={busy}
                      onStart={(id) => void doAction(() => api.start(id), '服务已启动')}
                      onStop={(id) => void doAction(() => api.stop(id), '服务已停止')}
                      onRestart={(id) => void doAction(() => api.restart(id), '服务已重启')}
                      onEdit={(id) => setEditor({ id, cfg: config?.services[id] ?? null })}
                      onDelete={(id) => {
                        if (!config) return;
                        if (!window.confirm(`删除服务 ${id}？将停止进程并移除配置。`)) return;
                        const next = { ...config.services };
                        delete next[id];
                        saveConfig({ ...config, services: next });
                      }}
                      onToggleAutostart={toggleAutostart}
                      onOpenLog={(id) => setLogId(id)}
                      onPromote={(id) => void promote(id)}
                      onDropTrial={(id) => void dropTrial(id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          <ResourceLedger gpu={gpu} services={services} warnThreshold={warnThreshold} />
        </div>
      </main>

      {editor && config && (
        <ServiceEditor
          initial={editor.cfg}
          initialId={editor.id}
          existingIds={Object.keys(config.services)}
          models={models}
          llamaConfigured={llamaConfigured}
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

      {showDownload && (
        <DownloadDialog
          onClose={() => setShowDownload(false)}
          onDone={(res) => void onDownloadDone(res)}
          onDownload={(req) => api.downloadModel(req) as Promise<DownloadResult>}
          onCancel={() => api.cancelDownload()}
          onProgress={api.onDownloadProgress}
        />
      )}

      {logId && (
        <LogViewer
          serviceId={logId}
          onClose={() => setLogId(null)}
          getLog={(id, tail) => api.getLog(id, tail)}
          clearLog={(id) => api.clearLog(id)}
          openLogDir={() => api.openLogDir()}
        />
      )}
    </div>
  );
}
