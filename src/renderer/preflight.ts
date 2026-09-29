import { AppConfig, GpuInfo, ServiceView } from './types';

/**
 * 预检：启动之前回答「现在能不能起」。
 *
 * 四族的顺序是固定的：**从最便宜可修到最贵可修**——
 * 依赖 → 环境 → 占用 → 资源。便宜的先查、先修，不要让人一上来就面对"显存不够"。
 *
 * 每一族都必须给出**可判断的句子**与**一个能立刻做的动作**，
 * 而不是一句"启动失败"。没有即使能做的动作时，动作留空并说明原因。
 */
export type FamilyId = 'dep' | 'env' | 'occ' | 'res';

export type ActionId =
  | 'release'      // 停掉占用者
  | 'change-port'  // 换端口（打开编辑器）
  | 'open-editor'  // 打开服务编辑
  | 'locate'       // 去设置里补路径
  | 'derate'       // 降需（打开编辑器调参数）
  | 'force';       // 强制启动（接受降级）

export interface PreflightAction {
  id: ActionId;
  label: string;
  /** 动作作用的对象（占用族停谁、降需改谁） */
  target?: string;
}

export interface PreflightItem {
  id: FamilyId;
  no: string;
  title: string;
  ok: boolean;
  /** 一句话结论：可判断的句子 */
  summary: string;
  /** 依据细节（数字、名字） */
  details: string[];
  /** 来源可信度：算出来的 / 读出来的 / 你声明的 / 不可用 */
  source: string;
  actions: PreflightAction[];
}

export interface PreflightResult {
  target: { kind: 'service' | 'group'; id: string; label: string };
  items: PreflightItem[];
  /** 至少一族不通过：调用方应该弹决策面而不是直接启动 */
  blocked: boolean;
}

const FAMILY_META: { id: FamilyId; no: string; title: string }[] = [
  { id: 'dep', no: '①', title: '依赖' },
  { id: 'env', no: '②', title: '环境' },
  { id: 'occ', no: '③', title: '占用' },
  { id: 'res', no: '④', title: '资源' },
];

function mb(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(1)} GB`;
  return `${Math.round(v)} MB`;
}

export interface PreflightInput {
  target: { kind: 'service' | 'group'; id: string; label: string };
  /** 要启动的成员 id（单服务就是它自己）；顺序即启动顺序 */
  memberIds: string[];
  services: Record<string, ServiceView>;
  config: AppConfig;
  gpu: GpuInfo | null;
}

/** 该成员是否已经在运行（预检只关心"还没跑的"要不要资源）
 *  'starting' 是主进程真实的状态名；'loading' 为历史兼容。 */
function isUp(svc: ServiceView | undefined): boolean {
  return !!svc && (
    svc.state === 'running'
    || svc.state === 'starting'
    || svc.state === 'loading'
    || svc.state === 'restarting'
  );
}

export function evaluatePreflight(input: PreflightInput): PreflightResult {
  const { target, memberIds, services, config, gpu } = input;
  const members = memberIds.map((id) => ({ id, cfg: config.services[id], view: services[id] }));
  const items: PreflightItem[] = [];

  /* ---------- ① 依赖 ---------- */
  {
    const dangling = members.filter((m) => !m.cfg).map((m) => m.id);
    const total = members.length;
    if (dangling.length > 0) {
      items.push({
        id: 'dep', no: '①', title: '依赖', ok: false,
        summary: `${dangling.length} 个成员的配置已缺失：${dangling.join('、')}`,
        details: [
          '预设组里留着已经不存在的服务 id（悬空成员）。',
          '这通常是先删了服务、却没有从组里摘掉它造成的。',
        ],
        source: '读出来的',
        actions: [{ id: 'open-editor', label: '去配置里修组' }],
      });
    } else if (target.kind === 'group' && total > 1) {
      const notUp = members.filter((m) => !isUp(m.view));
      items.push({
        id: 'dep', no: '①', title: '依赖', ok: true,
        summary: notUp.length === 0
          ? `${total} 个成员都已就绪`
          : `${notUp.length} 个成员未运行，将按成员顺序启动`,
        details: [
          `启动顺序：${memberIds.join(' → ')}`,
          '顺序就是依赖的表达：靠后的成员要用到靠前的能力。',
          '当前版本按顺序发起启动，但**不等前一个就绪**（有序 + 逐段等就绪在 M4）。',
        ],
        source: '你声明的',
        actions: [],
      });
    } else {
      items.push({
        id: 'dep', no: '①', title: '依赖', ok: true,
        summary: '未声明依赖',
        details: ['依赖目前只能通过预设组的成员顺序表达；单个服务没有依赖声明入口。'],
        source: '你声明的',
        actions: [],
      });
    }
  }

  /* ---------- ② 环境 ---------- */
  {
    const problems: string[] = [];
    const actions: PreflightAction[] = [];
    for (const m of members) {
      if (!m.cfg) continue;
      const kind = m.cfg.kind ?? (m.cfg.composeDir ? 'compose' : m.cfg.command ? 'command' : 'llama');
      const name = m.cfg.label || m.id;
      if (kind === 'llama') {
        if (!config.llamaServerPath.trim()) problems.push(`「${name}」需要 llama-server 路径，但设置里是空的`);
        if (!m.cfg.model.trim()) problems.push(`「${name}」没有选择模型文件`);
      } else if (kind === 'command') {
        if (!m.cfg.command?.trim()) problems.push(`「${name}」没有填可执行文件`);
      } else {
        if (!m.cfg.composeDir?.trim()) problems.push(`「${name}」没有填 Compose 目录`);
      }
    }
    if (problems.length > 0) {
      actions.push({ id: 'open-editor', label: '去补这项' });
      if (problems.some((p) => p.includes('llama-server'))) actions.push({ id: 'locate', label: '打开设置' });
    }
    items.push({
      id: 'env', no: '②', title: '环境', ok: problems.length === 0,
      summary: problems.length === 0 ? '必备项齐全' : `${problems.length} 项缺失`,
      details: problems.length === 0
        ? ['运行时路径、模型/命令/目录都已填写。', '注意：这里只校验「填没填」，不校验文件是否真的存在（那需要主进程去读盘）。']
        : problems,
      source: '读出来的',
      actions,
    });
  }

  /* ---------- ③ 占用 ---------- */
  {
    const conflicts: string[] = [];
    const actions: PreflightAction[] = [];
    for (const m of members) {
      if (!m.cfg || !m.cfg.port) continue;
      const port = String(m.cfg.port);
      // 端口被别的「正在运行的服务」占着（不含本组里要一起启动的成员）
      for (const [otherId, other] of Object.entries(services)) {
        if (otherId === m.id) continue;
        // 同组内「还没跑」的成员不算冲突（它们等一下才启动）；
        // 但同组内「已经在跑」的成员要算——若要启动的成员与它同端口，两者会同时在。
        if (memberIds.includes(otherId) && !isUp(other)) continue;
        if (other.port === m.cfg.port && isUp(other)) {
          conflicts.push(`端口 ${port} 已被运行中的「${other.label || otherId}」占用`);
          actions.push({ id: 'release', label: `停掉「${other.label || otherId}」`, target: otherId });
        }
      }
      if (actions.length === 0) actions.push({ id: 'change-port', label: '换端口', target: m.id });
    }
    // 独占：目标组标记独占时，与其它正在运行的独占组互斥
    if (target.kind === 'group' && (config.exclusivePresets ?? []).includes(target.id)) {
      for (const [name, ids] of Object.entries(config.presets ?? {})) {
        if (name === target.id) continue;
        if (!(config.exclusivePresets ?? []).includes(name)) continue;
        const running = ids.filter((id) => isUp(services[id]));
        if (running.length > 0) {
          conflicts.push(`本组标记为独占，而独占组「${name}」正在运行（${running.length} 个成员在跑）`);
          actions.unshift({ id: 'release', label: `停掉「${name}」`, target: running[0] });
        }
      }
    }
    const portless = members.filter((m) => m.cfg && !m.cfg.port && (m.cfg.kind ?? 'llama') !== 'compose');
    items.push({
      id: 'occ', no: '③', title: '占用', ok: conflicts.length === 0,
      summary: conflicts.length === 0 ? '无冲突' : `${conflicts.length} 处冲突`,
      details: conflicts.length === 0
        ? [
            portless.length > 0
              ? `有 ${portless.length} 个成员未声明端口，跳过端口占用检测。`
              : '端口与独占组都没有冲突。',
          ]
        : conflicts,
      source: '读出来的',
      actions: conflicts.length === 0 ? [] : actions.slice(0, 3),
    });
  }

  /* ---------- ④ 资源 ---------- */
  {
    const pending = members.filter((m) => !isUp(m.view));
    let need = 0;
    let unknown = 0;
    const named: string[] = [];
    for (const m of pending) {
      const v = m.view?.vramEstimateMB ?? m.view?.vramActualMB ?? null;
      if (v && v > 0) {
        need += v;
        named.push(`${m.cfg?.label || m.id} ${mb(v)}`);
      } else if (m.cfg) {
        // 源码与容器类服务的需求无法从配置推算；模型服务是「还没估算」。
        // 两种情况都不能算作"已验证够用"，所以要单独计数。
        unknown += 1;
      }
    }
    if (!gpu) {
      items.push({
        id: 'res', no: '④', title: '资源', ok: true,
        summary: '显存数据不可用，跳过资源预检',
        details: ['未检测到 NVIDIA 驱动时无法判断余量；这不是"够用"，而是"判断不了"。'],
        source: '不可用',
        actions: [],
      });
    } else if (need === 0 && unknown === 0) {
      items.push({
        id: 'res', no: '④', title: '资源', ok: true,
        summary: '没有需要新增的占用',
        details: ['要启动的成员都已在运行，不会新增显存占用。'],
        source: '算出来的',
        actions: [],
      });
    } else {
      const free = Math.max(gpu.totalMB - gpu.usedMB, 0);
      const gap = need - free;
      const inconclusive = unknown > 0;
      const actions: PreflightAction[] = [];
      if (gap > 0) {
        const candidates = Object.entries(services)
          .filter(([id, s]) => isUp(s) && !memberIds.includes(id) && (s.vramActualMB ?? s.vramEstimateMB ?? 0) > 0)
          .sort((a, b) => (b[1].vramActualMB ?? b[1].vramEstimateMB ?? 0) - (a[1].vramActualMB ?? a[1].vramEstimateMB ?? 0));
        for (const [id, s] of candidates.slice(0, 2)) {
          const can = s.vramActualMB ?? s.vramEstimateMB ?? 0;
          actions.push({ id: 'release', label: `停「${s.label || id}」释放 ${mb(can)}`, target: id });
        }
        const biggest = pending
          .filter((m) => (m.view?.vramEstimateMB ?? 0) > 0)
          .sort((a, b) => (b.view?.vramEstimateMB ?? 0) - (a.view?.vramEstimateMB ?? 0))[0];
        if (biggest) actions.push({ id: 'derate', label: '降需（调小 ctx）', target: biggest.id });
      }
      const summary = inconclusive
        ? (need > 0
            ? `已知需要 ${mb(need)}、余量 ${mb(free)}，另有 ${unknown} 个成员的需求无法推算`
            : `${unknown} 个成员的需求无法推算（源码与容器类服务没有需求声明入口）`)
        : (gap <= 0 ? `需要 ${mb(need)}，余量 ${mb(free)}，够用` : `需要 ${mb(need)}，余量 ${mb(free)}，差 ${mb(gap)}`);
      items.push({
        id: 'res', no: '④', title: '资源',
        // 推算不完整就不能算「通过」：让人显式接受，而不是悄悄放行。
        ok: gap <= 0 && !inconclusive,
        summary,
        details: [
          ...named,
          `显存余量按总量 ${mb(gpu.totalMB)} 与已用 ${mb(gpu.usedMB)} 计算（读出来的）。`,
          gap > 0 ? '模型服务的需求是推算值：GGUF 大小 + ctx 对应的 KV cache。' : '',
          inconclusive ? '源码与容器类服务无法推算需求，本族结论因此不完整。' : '',
        ].filter(Boolean),
        source: inconclusive ? '部分不可用' : '算出来的',
        actions,
      });
    }
  }

  // 按固定顺序输出：便宜的先修
  const ordered = FAMILY_META.map((meta) => items.find((i) => i.id === meta.id)).filter(Boolean) as PreflightItem[];
  return { target, items: ordered, blocked: ordered.some((i) => !i.ok) };
}
