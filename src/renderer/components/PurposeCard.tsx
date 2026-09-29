import { useState } from 'react';
import { ChevronDown, ChevronRight, Info, Lock, Play, RotateCw, Square, Users } from 'lucide-react';
import { ServiceView } from '../types';

export interface PurposeCardProps {
  /** 用途名（预设组名；单成员用途用服务自己的 label） */
  name: string;
  /** 该用途的成员（有序，顺序即启动顺序） */
  members: ServiceView[];
  /** 是否标记为独占（与其他独占组互斥） */
  exclusive: boolean;
  /** 被其他「正在运行的用途」共用的成员 id → 那些用途名 */
  sharedWith: Record<string, string[]>;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onRestartAll: () => void;
  onEditGroup: () => void;
  onDissolve: () => void;
  onStartMember: (id: string) => void;
  onStopMember: (id: string) => void;
  onDetail: (id: string) => void;
}

/** 单成员状态 → 中文状态词（与 dot-* 类名同源）
 *  注意 'starting' 是主进程真实的状态名；'loading' 只是历史写法，保留兼容。 */
export function stateLabel(svc: ServiceView): string {
  switch (svc.state) {
    case 'running': return svc.healthy ? '运行中' : '运行中 · 未就绪';
    case 'starting':
    case 'loading': return '启动中';
    case 'restarting': return '重启中';
    case 'failed': return '失败';
    default: return '已停止';
  }
}

export function dotClass(svc: ServiceView): string {
  switch (svc.state) {
    case 'running': return svc.healthy ? 'dot-running' : 'dot-loading';
    case 'starting':
    case 'loading': return 'dot-loading';
    case 'restarting': return 'dot-restarting';
    case 'failed': return 'dot-failed';
    default: return 'dot-stopped';
  }
}

export function formatMB(v: number | null | undefined): string {
  if (v == null || v <= 0) return '—';
  return v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${v} MB`;
}

/**
 * 用途卡：一张卡 = 一个用途（预设组）。
 * 只放决策所需的信息——可用性、成员就绪进度、异常原因；不堆字段。
 * 成员顺序就是启动顺序：ov-server 要等 embedding / intent 就绪才连得上，
 * 所以顺序不是装饰，展开后按序显示。
 */
export function PurposeCard(props: PurposeCardProps) {
  const { name, members, exclusive, sharedWith, busy } = props;
  const total = members.length;
  const ready = members.filter((m) => m.state === 'running' && m.healthy).length;
  const running = members.filter((m) => m.state === 'running').length;
  const broken = members.filter((m) => m.state === 'failed' || m.lastError);
  const [open, setOpen] = useState(total <= 1);

  const availability =
    running === 0 ? '未运行'
      : ready === total ? '可用'
        : `部分可用 ${ready}/${total}`;

  const tone = broken.length > 0 ? 'bad' : running === 0 ? 'idle' : ready === total ? 'ok' : 'warn';

  return (
    <div className="purpose">
      <div className={`purpose-bar ${tone}`} />
      <div className="purpose-body">
        <div className="purpose-head">
          <button className="purpose-toggle" onClick={() => setOpen((v) => !v)} title={open ? '收起成员' : '展开成员'}>
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <span className="purpose-name">{name}</span>
          <span className={`purpose-avail ${tone}`}>{availability}</span>
          {exclusive && (
            <span className="purpose-exclusive" title="独占：启动时会先确认停止其他独占组">
              <Lock size={12} /> 独占
            </span>
          )}
          <div className="purpose-actions">
            {running === 0 ? (
              <button className="btn primary small" disabled={busy} onClick={props.onEnable}>
                <Play size={13} /> 启用
              </button>
            ) : (
              <button className="btn small" disabled={busy} onClick={props.onDisable}>
                <Square size={13} /> 停用
              </button>
            )}
            <button
              className="btn small ghost"
              disabled={busy || running === 0}
              onClick={props.onRestartAll}
              title="逆序停止后按序重启"
            >
              <RotateCw size={13} /> 重启整组
            </button>
            <button className="btn small ghost" onClick={props.onEditGroup}>编辑组</button>
            <button className="btn small ghost" onClick={props.onDissolve} title="只解散组合，不删除任何服务">解散组</button>
          </div>
        </div>

        {broken.length > 0 && (
          <div className="purpose-alert">
            <span>{broken[0].lastError ?? `${broken.length} 个成员未就绪`}</span>
            <button className="btn small danger" onClick={() => props.onDetail(broken[0].id)}>
              <Info size={13} /> 处置
            </button>
          </div>
        )}

        {open && (
          <div className="member-list">
            {members.map((m, i) => (
              <div className="member" key={m.id}>
                <span className="member-ord">{i + 1}</span>
                <span className={`dot ${dotClass(m)}`} />
                <span className="member-name">{m.label || m.id}</span>
                <span className="member-port">{m.port ? `:${m.port}` : '—'}</span>
                <span className="member-state">{stateLabel(m)}</span>
                <span className="member-vram" title={m.vramActualMB ? '实测' : '推算'}>
                  {formatMB(m.vramActualMB ?? m.vramEstimateMB)}
                </span>
                {sharedWith[m.id]?.length ? (
                  <span className="member-shared" title="停用本组时该成员仍被这些运行中的用途需要">
                    <Users size={12} /> {sharedWith[m.id].join('、')}
                  </span>
                ) : null}
                <span className="member-actions">
                  {m.state === 'running' ? (
                    <button className="btn small" disabled={busy} onClick={() => props.onStopMember(m.id)}>停止</button>
                  ) : (
                    <button
                      className="btn small primary"
                      disabled={busy || !m.enabled}
                      onClick={() => props.onStartMember(m.id)}
                    >
                      {m.enabled ? '启动' : '已禁用'}
                    </button>
                  )}
                  <button className="btn small ghost" onClick={() => props.onDetail(m.id)}>详情</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
