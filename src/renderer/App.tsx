import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, LogOut, SlidersHorizontal, ArrowLeft, RefreshCw } from 'lucide-react';
import { AppConfig, DownloadResult, GpuInfo, ModelEntry, ProbeResult, ServiceConfig, ServiceKind, ServiceView } from './types';
import { evaluatePreflight, PreflightAction, PreflightResult } from './preflight';
import { PreflightDialog } from './components/PreflightDialog';
import { ServiceCard, basename } from './components/ServiceCard';
import { PurposeCard } from './components/PurposeCard';
import { ResourceLedger } from './components/ResourceLedger';
import { ConfigView } from './components/ConfigView';
import { PresetManager } from './components/PresetManager';
import { ServiceEditor } from './components/ServiceEditor';
import { SettingsPanel } from './components/SettingsPanel';
import { ServiceDrawer } from './components/ServiceDrawer';
import { ToastStack, Toast, TOAST_MAX } from './components/ToastStack';
import { ConfirmDialog, ConfirmKind, ConfirmRequest } from './components/ConfirmDialog';
import { ProbeDialog } from './components/ProbeDialog';
import { Fix } from './diagnose';
import { DownloadDialog } from './components/DownloadDialog';

type EditorState = { id: string | null; cfg: ServiceConfig | null } | null;

/** 状态轮询间隔：状态变更还会由主进程主动推送，这里只做兜底与显存刷新 */
const POLL_INTERVAL_MS = 5000;

export function App() {
  const api = window.serviceHubApi;
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [services, setServices] = useState<ServiceView[]>([]);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  /** 提示栈：成功自动消失，失败常驻（见 ToastStack 的说明） */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  /** 危险动作的确认请求：kind 决定文案 */
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  /** 编辑器是从哪个房间进来的：返回时回到那里，而不是固定去配置态 */
  const [editorFrom, setEditorFrom] = useState<'run' | 'config'>('config');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  /** 新增服务前先探测：选目录 → 判断形态 → 用这个形态继续 */
  const [showProbe, setShowProbe] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState(false);
  /** 运行态是默认房间；配置态是显式进出的房间 */
  const [view, setView] = useState<'run' | 'config' | 'editor'>('run');
  /** 预检未通过时的裁决面：result 是判定，run 是「人决定继续」时要执行的动作 */
  const [pf, setPf] = useState<{ result: PreflightResult; run: () => void } | null>(null);
  const toastTimers = useRef<number[]>([]);

  const showToast = useCallback((kind: 'ok' | 'error', text: string) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((prev) => [...prev, { id, kind, text }].slice(-TOAST_MAX));
    if (kind === 'ok') {
      // 成功 4 秒后自己走；失败留在屏幕上等人处理
      const timer = window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
      toastTimers.current.push(timer);
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** 危险动作统一走确认面：每种动作有自己的文案（发生了什么 / 不会发生什么） */
  const askConfirm = useCallback((
    kind: ConfirmKind,
    subject: string,
    onConfirm: () => void,
    extra?: string[],
  ) => {
    setConfirm({ kind, subject, onConfirm, extra });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [cfg, status] = await Promise.all([api.getConfig(), api.status()]);
      setConfig(cfg);
      setServices(status.services ?? []);
      setGpu(status.gpu ?? null);
    } catch (err) {
      showToast('error', `状态加载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [api, showToast]);

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
    for (const t of toastTimers.current) window.clearTimeout(t);
  }, []);

  const doAction = async (action: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await action();
      showToast('ok', okText);
      await refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err));
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

  // 启动前的判断统一归预检（含独占组冲突），这里只负责「按顺序发起」。
  const startPresetRaw = async (members: string[]) => {
    for (const id of members) {
      await doAction(() => api.start(id), `已启动 ${id}`);
    }
  };

  /** 预检门：通过就直接跑；不通过就摆出裁决面，让人决定 */
  const gate = (
    target: { kind: 'service' | 'group'; id: string; label: string },
    memberIds: string[],
    run: () => void,
  ) => {
    if (!config) { run(); return; }
    const views: Record<string, ServiceView> = Object.fromEntries(services.map((s) => [s.id, s]));
    const result = evaluatePreflight({ target, memberIds, services: views, config, gpu });
    if (!result.blocked) { run(); return; }
    setPf({ result, run });
  };

  /** 单个服务的启动都要过预检门 */
  const gateService = (id: string) => {
    gate(
      { kind: 'service', id, label: config?.services[id]?.label || id },
      [id],
      () => void doAction(() => api.start(id), '服务已启动'),
    );
  };

  /** 重新预检：用当前状态再判一次（例如刚停掉占用者之后） */
  const recheckPreflight = () => {
    setPf((prev) => {
      if (!prev || !config) return prev;
      const views: Record<string, ServiceView> = Object.fromEntries(services.map((s) => [s.id, s]));
      const memberIds = prev.result.target.kind === 'service'
        ? [prev.result.target.id]
        : (config.presets[prev.result.target.id] ?? []);
      return {
        result: evaluatePreflight({ target: prev.result.target, memberIds, services: views, config, gpu }),
        run: prev.run,
      };
    });
  };

  /** 处置抽屉里的修正动作：能就地做的就地做，要改配置的把人送过去 */
  const drawerFix = (f: Fix) => {
    const id = logId;
    if (!id) return;
    if (f.id === 'retry') { setLogId(null); gateService(id); return; }
    if (f.id === 'stop') {
      // 正在反复重启时，停止会连带终止自动重启，属于危险动作
      if (drawerSvc && (drawerSvc.state === 'restarting' || drawerSvc.state === 'failed')) {
        askConfirm('stop-crashing', drawerSvc.label || id, () => { void doAction(() => api.stop(id), '已停止'); });
      } else {
        void doAction(() => api.stop(id), '已停止');
      }
      return;
    }
    if (f.id === 'release' && f.target) {
      const target = f.target;
      void doAction(() => api.stop(target), '已停止占用者');
      return;
    }
    if (f.id === 'open-log-dir') { void api.openLogDir(); return; }
    if (f.id === 'edit') { setLogId(null); openEditor(id); return; }
    if (f.id === 'enable' && config) {
      const svc = config.services[id];
      if (svc) saveConfig({ ...config, services: { ...config.services, [id]: { ...svc, enabled: true } } });
    }
  };

  /** 决策面的就地出口：停占用者后立刻继续启动；其余出口把人送到能改的地方 */
  const preflightAction = async (a: PreflightAction) => {
    if (!pf) return;
    const go = pf.run;
    if (a.id === 'release' && a.target) {
      const target = a.target;
      await doAction(() => api.stop(target), '已停止占用者');
      setPf(null);
      go();
      return;
    }
    if (a.id === 'locate') { setPf(null); setShowSettings(true); return; }
    if (a.id === 'open-editor' && !a.target) { setPf(null); setView('config'); setShowPresets(true); return; }
    if (a.target) { setPf(null); openEditor(a.target); return; }
    setPf(null);
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
    askConfirm('dissolve-group', name, () => {
      const presets = { ...config.presets };
      delete presets[name];
      saveConfig({
        ...config,
        presets,
        exclusivePresets: (config.exclusivePresets ?? []).filter((n) => n !== name),
      });
    });
  };

  /** 复制服务：同类配置复用（改模型与端口即可），新 id 加后缀并避开已占用 */
  const copyService = (id: string) => {
    if (!config) return;
    const src = config.services[id];
    if (!src) return;
    let n = 2;
    while (config.services[`${id}-${n}`]) n += 1;
    const nextId = `${id}-${n}`;
    const port = src.port ? src.port + n - 1 : src.port;
    saveConfig({
      ...config,
      services: {
        ...config.services,
        [nextId]: { ...src, label: `${src.label} (副本)`, port, autostart: false },
      },
    });
    showToast('ok', `已复制为 ${nextId}（端口 ${port}）— 记得改成不同的模型或端口`);
  };

  const deleteService = (id: string) => {
    if (!config) return;
    // 说清"会从哪些组里摘掉"，而不是笼统地说"会移除配置"
    const affected = Object.entries(config.presets ?? {})
      .filter(([, ids]) => ids.includes(id))
      .map(([name]) => name);
    askConfirm('delete-service', config.services[id]?.label || id, () => {
      const next = { ...config.services };
      delete next[id];
      // 从所有预设组里摘掉，避免留下悬空成员
      const presets: Record<string, string[]> = {};
      for (const [name, ids] of Object.entries(config.presets ?? {})) {
        presets[name] = ids.filter((x) => x !== id);
      }
      saveConfig({ ...config, services: next, presets });
    }, affected.length > 0 ? [`会把它从这 ${affected.length} 个组里摘掉：${affected.join('、')}`] : []);
  };

  const startTrial = async (m: ModelEntry) => {
    await doAction(() => api.startTrial(m.path, m.siblingMmproj ?? undefined), `已临时启动 ${basename(m.path)}`);
  };

  /** 转正：主进程用体验服务的完整参数写入持久配置并启动，避免丢失启动参数 */
  const promote = async (id: string) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    // 转正是加法（写入一条持久配置并启动），不是危险动作，不需要确认面
    setBusy(true);
    try {
      const next = await api.promote({ trialId: id }) as AppConfig;
      setConfig(next);
      showToast('ok', `已转正为持久服务：${svc.label}`);
      await refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const dropTrial = async (id: string) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    askConfirm('drop-trial', svc.label || id, () => {
      void doAction(() => api.dropTrial(id), '已移除体验服务');
    });
  };

  const onDownloadDone = async (res: DownloadResult) => {
    setShowDownload(false);
    showToast('ok', `下载完成${res.sha256Verified ? '（SHA256 校验通过）' : ''}：${res.path ?? ''}`);
    await refreshModels(true);
    await refresh();
  };

  const applyReloadedConfig = async () => {
    setConfigNotice(false);
    try {
      const res = await api.reloadConfig();
      showToast('ok', `已应用外部配置${res.restarted.length > 0 ? `，重启了 ${res.restarted.length} 个服务` : ''}`);
      await refresh();
    } catch (err) {
      showToast('error', `应用配置失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const warnThreshold = config?.vramWarnThreshold ?? 90;

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

  /** 端口 → 占用它的服务名：编辑器的「暴露与就绪」段用它做冲突提醒 */
  const portOwners: Record<string, string> = {};
  for (const [id, cfg] of Object.entries(config?.services ?? {})) {
    if (cfg.port) portOwners[String(cfg.port)] = cfg.label || id;
  }

  /** 探测结果 → 服务编辑的预填值。判断不出来的字段一律不填，留空让人自己填。 */
  const prefillFromProbe = (r: ProbeResult): ServiceConfig => {
    const kind: ServiceKind = r.kind === 'compose' ? 'compose' : r.kind === 'command' ? 'command' : 'llama';
    const base: ServiceConfig = {
      label: r.suggestion.label ?? '',
      role: '', model: '', mmproj: '', alias: '',
      port: r.suggestion.port ?? 0,
      args: [], autostart: false, enabled: true, kind,
    };
    if (kind === 'compose') {
      return {
        ...base,
        composeDir: r.suggestion.composeDir ?? '',
        composeFile: r.suggestion.composeFile,
        composeProfiles: r.suggestion.composeProfiles,
      };
    }
    if (kind === 'command') return { ...base, cwd: r.suggestion.cwd, command: r.suggestion.command ?? '' };
    return { ...base, model: r.suggestion.model ?? '', mmproj: r.suggestion.mmproj ?? '' };
  };

  /** 打开服务编辑（二级页）；id 为 null 表示新增。记住来源，返回时回到进来的那个房间。 */
  const openEditor = (id: string | null) => {
    setEditorFrom(view === 'run' ? 'run' : 'config');
    setEditor({ id, cfg: id && config ? config.services[id] ?? null : null });
    setView('editor');
  };

  /** 处置抽屉对应的服务（它可能刚被删掉） */
  const drawerSvc = logId ? services.find((s) => s.id === logId) ?? null : null;

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <div className="header-title">服务中枢</div>
          <div className="header-sub">本机服务 · 进程 · 容器</div>
        </div>
        <div className="header-spacer" />
        {view === 'run' ? (
          <button className="btn" onClick={() => setView('config')}>
            <SlidersHorizontal size={15} /> 配置
          </button>
        ) : (
          <button className="btn" onClick={() => setView('run')}>
            <ArrowLeft size={15} /> 返回运行态
          </button>
        )}
        <button className="btn ghost" onClick={() => setShowSettings(true)}><Settings size={15} /> 设置</button>
        <button
          className="btn ghost"
          onClick={() => askConfirm('quit', '', () => void api.quit())}
        >
          <LogOut size={15} /> 退出
        </button>
      </header>

      <main className="main">
        {configNotice && (
          <div className="notice-bar">
            <span>检测到 services.json 被外部修改。</span>
            <button className="btn small primary" onClick={() => void applyReloadedConfig()}><RefreshCw size={13} /> 应用</button>
            <button className="btn small ghost" onClick={() => setConfigNotice(false)}>忽略</button>
          </div>
        )}

        {view === 'editor' && config && editor ? (
          <ServiceEditor
            initial={editor.cfg}
            initialId={editor.id}
            existingIds={Object.keys(config.services)}
            models={models}
            llamaConfigured={llamaConfigured}
            portOwners={portOwners}
            onSave={(id, cfg) => {
              const next = { ...config.services, [id]: cfg };
              if (editor.id && editor.id !== id && config.services[editor.id]) delete next[editor.id];
              saveConfig({ ...config, services: next });
              setEditor(null);
              setView(editorFrom);
              showToast('ok', `已保存 ${cfg.label || id}`);
            }}
            onCancel={() => { setEditor(null); setView(editorFrom); }}
          />
        ) : view === 'config' && config ? (
          <ConfigView
            config={config}
            services={services}
            models={models}
            busy={busy}
            showModelPanel={showModelPanel}
            onNewService={() => setShowProbe(true)}
            onEditService={(id) => openEditor(id)}
            onCopyService={copyService}
            onDeleteService={deleteService}
            onOpenLog={(id) => setLogId(id)}
            onOpenGroupEditor={() => setShowPresets(true)}
            onDissolveGroup={dissolvePreset}
            onRefreshModels={(force) => void refreshModels(force)}
            onOpenDownload={() => setShowDownload(true)}
            onTrialModel={(m) => void startTrial(m)}
          />
        ) : (
        <div className="run-grid">
          <div className="run-main">
            <div className="list-head">
              <span className="list-title">用途</span>
              <span className="count">
                {services.length} 个服务 · {presetEntries.length + ungrouped.length} 个用途
                {showModelPanel && ` · ${models.length} 个可加载模型`}
              </span>
              <span className="list-spacer" />
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
                  onEnable={() => gate({ kind: 'group', id: name, label: name }, ids, () => void startPresetRaw(ids))}
                  onDisable={() => stopPreset(name, ids)}
                  onRestartAll={() => void restartPreset(ids)}
                  onEditGroup={() => setShowPresets(true)}
                  onDissolve={() => dissolvePreset(name)}
                  onStartMember={(id) => gateService(id)}
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
                      onStart={(id) => gateService(id)}
                      onStop={(id) => void doAction(() => api.stop(id), '服务已停止')}
                      onRestart={(id) => void doAction(() => api.restart(id), '服务已重启')}
                      onEdit={(id) => openEditor(id)}
                      onDelete={(id) => deleteService(id)}
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
        )}
      </main>

      {pf && (
        <PreflightDialog
          result={pf.result}
          busy={busy}
          onAction={(a) => void preflightAction(a)}
          onRecheck={recheckPreflight}
          onForce={() => { const go = pf.run; setPf(null); go(); }}
          onCancel={() => setPf(null)}
        />
      )}

      {showSettings && config && (
        <SettingsPanel
          config={config}
          onSave={(cfg) => { saveConfig(cfg); setShowSettings(false); }}
          onCancel={() => setShowSettings(false)}
          listSnapshots={() => api.listSnapshots()}
          restoreSnapshot={(name) => api.restoreSnapshot(name)}
          onRestored={(cfg) => setConfig(cfg)}
          askConfirm={askConfirm}
        />
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

      {logId && drawerSvc && config && (
        <ServiceDrawer
          svc={drawerSvc}
          config={config}
          portOwners={portOwners}
          busy={busy}
          onClose={() => setLogId(null)}
          onFix={drawerFix}
          getLog={(id, tail) => api.getLog(id, tail)}
          clearLog={(id) => api.clearLog(id)}
          openLogDir={() => api.openLogDir()}
          listRuns={(serviceId, limit) => api.listRuns(serviceId, limit)}
          clearRuns={(serviceId) => api.clearRuns(serviceId)}
        />
      )}

      {showProbe && (
        <ProbeDialog
          onPick={() => api.pickDirectory()}
          onInspect={(p) => api.inspectPath(p)}
          onUse={(r) => {
            setShowProbe(false);
            setEditorFrom('config');
            setEditor({ id: null, cfg: prefillFromProbe(r) });
            setView('editor');
          }}
          onSkip={() => { setShowProbe(false); openEditor(null); }}
          onCancel={() => setShowProbe(false)}
        />
      )}

      {confirm && <ConfirmDialog req={confirm} onCancel={() => setConfirm(null)} />}

      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onClearAll={() => setToasts([])}
      />
    </div>
  );
}
