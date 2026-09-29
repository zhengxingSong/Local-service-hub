import { Cpu, HardDrive } from 'lucide-react';
import { GpuInfo, ServiceView } from '../types';
import { formatMB } from './PurposeCard';

export interface ResourceLedgerProps {
  gpu: GpuInfo | null;
  services: ServiceView[];
  warnThreshold: number;
}

interface Attribution {
  id: string;
  label: string;
  mb: number;
  measured: boolean;
}

/**
 * 资源账本：不是监控仪表盘，而是预检的可视化。
 * 它回答三个决策问题——还能启动什么、是谁在吃、启动目标会不会挤爆。
 *
 * 占比与差值都只用主进程已有的数据算：显存来自 nvidia-smi，
 * 每个服务的占用取 vramActualMB（实测）优先、否则 vramEstimateMB（推算）。
 */
export function ResourceLedger({ gpu, services, warnThreshold }: ResourceLedgerProps) {
  if (!gpu) {
    return (
      <aside className="ledger">
        <div className="ledger-head"><HardDrive size={15} /> 资源</div>
        <div className="ledger-empty">
          显存数据不可用。未检测到 NVIDIA 驱动时本面板不显示读数——不要用 0 假装读到了。
        </div>
      </aside>
    );
  }

  const used = gpu.usedMB;
  const total = gpu.totalMB;
  const free = Math.max(total - used, 0);
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;

  // 本应用管理的服务占用了多少（实测优先，否则推算）
  const attribution: Attribution[] = services
    .filter((s) => s.state === 'running')
    .map((s) => ({
      id: s.id,
      label: s.label || s.id,
      mb: s.vramActualMB ?? s.vramEstimateMB ?? 0,
      measured: s.vramActualMB != null && s.vramActualMB > 0,
    }))
    .filter((a) => a.mb > 0)
    .sort((a, b) => b.mb - a.mb);

  const managed = attribution.reduce((sum, a) => sum + a.mb, 0);
  // 余量里再扣掉非本应用管理的部分，才是真正可分配给新服务的量
  const others = Math.max(used - managed, 0);

  // 可启动清单：已停止、已启用、有需求估算的服务
  const candidates = services.filter((s) => s.state !== 'running' && s.enabled);
  const fits = candidates.filter((s) => (s.vramEstimateMB ?? 0) > 0 && (s.vramEstimateMB ?? 0) <= free);
  const needsRelease = candidates
    .filter((s) => (s.vramEstimateMB ?? 0) > free)
    .sort((a, b) => (a.vramEstimateMB ?? 0) - (b.vramEstimateMB ?? 0));

  return (
    <aside className="ledger">
      <div className="ledger-head"><HardDrive size={15} /> 资源</div>

      <div className="ledger-block">
        <div className="ledger-row">
          <span>显存</span>
          <b>{formatMB(used)} / {formatMB(total)}</b>
        </div>
        <div className="gpu-bar">
          <div className={`gpu-fill${pct >= warnThreshold ? ' warn' : ''}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="ledger-sub">
          <span>{pct}%</span>
          <span>可用 <b>{formatMB(free)}</b></span>
          {pct >= warnThreshold && <span className="gpu-warn-tag">显存紧张</span>}
        </div>
      </div>

      <div className="ledger-block">
        <div className="ledger-sub-head">还能启动什么</div>
        <div className="ledger-list">
          {fits.length === 0 && needsRelease.length === 0 && (
            <div className="ledger-note">没有待启动的服务。</div>
          )}
          {fits.map((s) => (
            <div className="ledger-item" key={s.id}>
              <span className="ledger-name">{s.label || s.id}</span>
              <span className="ledger-val">{formatMB(s.vramEstimateMB)}</span>
              <span className="ledger-fit ok">可启动</span>
            </div>
          ))}
          {needsRelease.map((s) => {
            const gap = (s.vramEstimateMB ?? 0) - free;
            return (
              <div className="ledger-item" key={s.id}>
                <span className="ledger-name">{s.label || s.id}</span>
                <span className="ledger-val">{formatMB(s.vramEstimateMB)}</span>
                <span className="ledger-fit bad">差 {formatMB(gap)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ledger-block">
        <div className="ledger-sub-head">占用者</div>
        <div className="ledger-list">
          {attribution.length === 0 && <div className="ledger-note">当前没有本应用管理的服务在运行。</div>}
          {attribution.map((a) => (
            <div className="ledger-item" key={a.id}>
              <span className="ledger-name">{a.label}</span>
              <span className="ledger-val">{formatMB(a.mb)}</span>
              <span className={`ledger-src ${a.measured ? 'ok' : ''}`}>{a.measured ? '实测' : '推算'}</span>
            </div>
          ))}
          {others > 0 && (
            <div className="ledger-item">
              <span className="ledger-name">其它进程</span>
              <span className="ledger-val">{formatMB(others)}</span>
              <span className="ledger-src">差值</span>
            </div>
          )}
        </div>
        <div className="ledger-note">
          <Cpu size={12} /> 服务的占用优先显示实测值；没有实测时用 GGUF 与启动参数推算。
        </div>
      </div>
    </aside>
  );
}
