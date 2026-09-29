import { useMemo, useState } from 'react';
import { Download, Lock, Plus, RefreshCw, Pencil, Trash2, Copy, Settings2 } from 'lucide-react';
import { AppConfig, ModelEntry, ServiceView } from '../types';
import { dotClass, stateLabel } from './PurposeCard';
import { basename, formatSize } from './ServiceCard';

export interface ConfigViewProps {
  config: AppConfig;
  services: ServiceView[];
  models: ModelEntry[];
  busy: boolean;
  showModelPanel: boolean;
  onNewService: () => void;
  onEditService: (id: string) => void;
  onCopyService: (id: string) => void;
  onDeleteService: (id: string) => void;
  onOpenLog: (id: string) => void;
  onOpenGroupEditor: () => void;
  onDissolveGroup: (name: string) => void;
  onRefreshModels: (force?: boolean) => void;
  onOpenDownload: () => void;
  onTrialModel: (m: ModelEntry) => void;
}

type Tab = 'services' | 'groups' | 'assets';

const KIND_LABEL: Record<string, string> = {
  llama: '模型服务',
  command: '源代码部署',
  compose: 'docker 应用',
};

/**
 * 配置态：一个有明确进出口的房间，主体是「定义」而不是「当下」。
 * 三个页签分别是 服务 / 预设组 / 素材；口径与 ui-l2-carbon.html 一致。
 */
export function ConfigView(props: ConfigViewProps) {
  const { config, services, models, busy } = props;
  const [tab, setTab] = useState<Tab>('services');

  const viewById = useMemo(
    () => Object.fromEntries(services.map((s) => [s.id, s])),
    [services],
  );

  /** 服务 → 它出现在哪些预设组里（一个服务可以属于多个组） */
  const groupsOf = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const [name, ids] of Object.entries(config.presets ?? {})) {
      for (const id of ids) {
        if (!map[id]) map[id] = [];
        map[id].push(name);
      }
    }
    return map;
  }, [config.presets]);

  /** 素材引用状态：被哪些服务引用 / 未被引用 / 与另一条仅大小写不同（重复素材） */
  const assetInfo = useMemo(() => {
    const referencedBy: Record<string, string[]> = {};
    for (const [id, svc] of Object.entries(config.services)) {
      const refs = [svc.model, svc.mmproj].filter(Boolean) as string[];
      for (const p of refs) {
        if (!referencedBy[p]) referencedBy[p] = [];
        referencedBy[p].push(svc.label || id);
      }
    }
    const lower = new Map<string, number>();
    for (const m of models) {
      const k = basename(m.path).toLowerCase();
      lower.set(k, (lower.get(k) ?? 0) + 1);
    }
    return { referencedBy, lower };
  }, [config.services, models]);

  const serviceIds = Object.keys(config.services);
  const presetEntries = Object.entries(config.presets ?? {});
  const groupedIds = new Set(presetEntries.flatMap(([, ids]) => ids));
  const ungrouped = serviceIds.filter((id) => !groupedIds.has(id));

  return (
    <div className="cfg">
      <div className="cfg-tabs" role="tablist">
        <button className={`cfg-tab${tab === 'services' ? ' on' : ''}`} onClick={() => setTab('services')}>
          服务 · {serviceIds.length}
        </button>
        <button className={`cfg-tab${tab === 'groups' ? ' on' : ''}`} onClick={() => setTab('groups')}>
          预设组 · {presetEntries.length}
        </button>
        <button className={`cfg-tab${tab === 'assets' ? ' on' : ''}`} onClick={() => setTab('assets')}>
          素材 · {models.length}
        </button>
      </div>

      {/* ---------------- 服务清单：定义视角，不显示实时运行态的细节 ---------------- */}
      {tab === 'services' && (
        <div className="cfg-pane">
          <div className="cfg-tool">
            <button className="btn primary small" onClick={props.onNewService}>
              <Plus size={14} /> 新增服务
            </button>
            <span className="count">
              {serviceIds.length} 个服务 · {presetEntries.length} 个预设组
            </span>
            <span className="list-spacer" />
            <span className="cfg-note">这里只看定义：名称 / 形态 / 暴露 / 归属组 / 启用与运行状态</span>
          </div>

          {serviceIds.length === 0 ? (
            <div className="empty">
              暂无服务。点击「新增服务」添加 llama.cpp 模型服务、任意命令进程或 Docker Compose 容器栈。
            </div>
          ) : (
            <table className="cfg-table">
              <thead>
                <tr>
                  <th style={{ width: 190 }}>服务</th>
                  <th style={{ width: 96 }}>形态</th>
                  <th>暴露</th>
                  <th style={{ width: 150 }}>归属组</th>
                  <th style={{ width: 168 }}>状态位</th>
                  <th style={{ width: 116 }}></th>
                </tr>
              </thead>
              <tbody>
                {serviceIds.map((id) => {
                  const cfg = config.services[id];
                  const view = viewById[id];
                  const groups = groupsOf[id] ?? [];
                  return (
                    <tr key={id}>
                      <td>
                        <span className={`dot ${view ? dotClass(view) : 'dot-stopped'}`} />
                        <span className="cfg-name">{cfg.label || id}</span>
                        <span className="cfg-id">{id}</span>
                      </td>
                      <td><span className="kind-badge">{KIND_LABEL[cfg.kind ?? 'llama'] ?? cfg.kind}</span></td>
                      <td>
                        <span className="cfg-mono">{cfg.port || '—'}</span>
                        {cfg.alias ? <span className="cfg-alias">{cfg.alias}</span> : null}
                      </td>
                      <td>
                        {groups.length === 0
                          ? <span className="cfg-none">未分组 · 各自成为一个用途</span>
                          : groups.map((g) => <span className="cfg-group" key={g}>{g}</span>)}
                      </td>
                      <td>
                        <span className={`cfg-flag ${cfg.enabled ? 'ok' : ''}`}>{cfg.enabled ? '已启用' : '已禁用'}</span>
                        <span className="cfg-flag">{view ? stateLabel(view) : '未知'}</span>
                      </td>
                      <td>
                        <span className="cfg-rowacts">
                          <button className="btn small ghost" title="编辑定义" onClick={() => props.onEditService(id)}>
                            <Pencil size={13} />
                          </button>
                          <button className="btn small ghost" title="复制为一份新服务（改模型与端口即可）" onClick={() => props.onCopyService(id)}>
                            <Copy size={13} />
                          </button>
                          <button className="btn small ghost" title="查看日志" onClick={() => props.onOpenLog(id)}>
                            日志
                          </button>
                          <button className="btn small danger" title="删除服务" onClick={() => props.onDeleteService(id)}>
                            <Trash2 size={13} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ---------------- 预设组：成员顺序就是启动与停止顺序 ---------------- */}
      {tab === 'groups' && (
        <div className="cfg-pane">
          <div className="cfg-tool">
            <button className="btn primary small" onClick={props.onOpenGroupEditor}>
              <Plus size={14} /> 新建 / 编辑预设组
            </button>
            <span className="count">{presetEntries.length} 个组 · {ungrouped.length} 个未分组服务</span>
            <span className="list-spacer" />
            <span className="cfg-note">成员顺序即启动顺序；停止时逆序</span>
          </div>

          {presetEntries.length === 0 && <div className="empty">还没有预设组。一个组就是一个「用途」。</div>}

          {presetEntries.map(([name, ids]) => {
            const exclusive = (config.exclusivePresets ?? []).includes(name);
            return (
              <div className="group-card" key={name}>
                <div className="group-head">
                  <span className="group-name">{name}</span>
                  {exclusive && <span className="purpose-exclusive"><Lock size={12} /> 独占</span>}
                  <span className="group-count">{ids.length} 个成员</span>
                  <span className="list-spacer" />
                  <button className="btn small ghost" onClick={props.onOpenGroupEditor}>
                    <Settings2 size={13} /> 编辑
                  </button>
                  <button className="btn small ghost" title="只解散组合，不删除任何服务" onClick={() => props.onDissolveGroup(name)}>
                    解散组
                  </button>
                </div>
                <div className="member-list">
                  {ids.map((id, i) => {
                    const view = viewById[id];
                    const cfg = config.services[id];
                    const missing = !cfg;
                    return (
                      <div className="member" key={id}>
                        <span className="member-ord">{i + 1}</span>
                        <span className={`dot ${view ? dotClass(view) : 'dot-stopped'}`} />
                        <span className="member-name">{cfg?.label || id}</span>
                        <span className="member-port">{cfg?.port ? `:${cfg.port}` : '—'}</span>
                        <span className="member-state">{missing ? '配置已缺失（悬空成员）' : view ? stateLabel(view) : '未知'}</span>
                        <span className="member-vram">
                          {missing ? '—' : cfg.enabled ? '已启用' : '已禁用'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {ungrouped.length > 0 && (
            <>
              <div className="list-sub">未分组服务 · 各自成为一个单成员用途（{ungrouped.length}）</div>
              <div className="group-card">
                <div className="member-list">
                  {ungrouped.map((id) => {
                    const view = viewById[id];
                    const cfg = config.services[id];
                    return (
                      <div className="member" key={id}>
                        <span className="member-ord">—</span>
                        <span className={`dot ${view ? dotClass(view) : 'dot-stopped'}`} />
                        <span className="member-name">{cfg.label || id}</span>
                        <span className="member-port">{cfg.port ? `:${cfg.port}` : '—'}</span>
                        <span className="member-state">{KIND_LABEL[cfg.kind ?? 'llama'] ?? cfg.kind}</span>
                        <span className="member-vram">{cfg.enabled ? '已启用' : '已禁用'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- 素材：被引用型资源，删除前必须看引用 ---------------- */}
      {tab === 'assets' && (
        <div className="cfg-pane">
          <div className="cfg-tool">
            <button className="btn small" disabled={busy} onClick={() => props.onRefreshModels(true)}>
              <RefreshCw size={13} /> 重新扫描
            </button>
            <button className="btn small" onClick={props.onOpenDownload}>
              <Download size={13} /> 下载模型
            </button>
            <span className="count">{models.length} 个模型文件</span>
            <span className="list-spacer" />
            <span className="cfg-note">素材可被多个服务共用；删除前先看引用</span>
          </div>

          {!props.showModelPanel && (
            <div className="empty">
              未配置 llama 运行时或扫描根，模型扫描不可用。可在「设置」里填写。
            </div>
          )}

          {props.showModelPanel && models.length === 0 && (
            <div className="empty">没有扫描到模型文件。检查「设置」里的扫描根。</div>
          )}

          {props.showModelPanel && models.length > 0 && (
            <table className="cfg-table">
              <thead>
                <tr>
                  <th>文件</th>
                  <th style={{ width: 96 }}>大小</th>
                  <th style={{ width: 190 }}>被引用</th>
                  <th style={{ width: 150 }}>备注</th>
                  <th style={{ width: 96 }}></th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const refs = assetInfo.referencedBy[m.path] ?? [];
                  const dupCount = assetInfo.lower.get(basename(m.path).toLowerCase()) ?? 0;
                  return (
                    <tr key={m.path}>
                      <td><span className="cfg-path" title={m.path}>{basename(m.path)}</span></td>
                      <td><span className="cfg-mono">{formatSize(m.sizeBytes)}</span></td>
                      <td>
                        {refs.length === 0
                          ? <span className="cfg-none">未被任何服务引用</span>
                          : refs.map((r) => <span className="cfg-group" key={r}>{r}</span>)}
                      </td>
                      <td>
                        {dupCount > 1 && <span className="cfg-warn">同名重复（{dupCount} 个）</span>}
                        {m.siblingMmproj && <span className="cfg-ok">含 mmproj</span>}
                      </td>
                      <td>
                        <button
                          className="btn small primary"
                          disabled={busy}
                          title="以临时端口启动，满意后再转正"
                          onClick={() => props.onTrialModel(m)}
                        >
                          试运行
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
