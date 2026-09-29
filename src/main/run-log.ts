import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServiceView } from './service-manager';

/**
 * 运行记录：每次「启动 → 结束」是一条 Run。
 *
 * 它回答的是**现状回答不了的问题**：这个服务上次起用了多久？就绪花了多久？
 * 是不是越来越慢？上次失败发生在启动阶段还是运行阶段？
 * 抽屉里的归因说的是"这一次为什么"，运行记录说的是"它一直怎么样"。
 *
 * 记录由状态变化推导，不改 service-manager 的内部：主进程每次广播状态时把
 * 全部 ServiceView 交进来，RunTracker 比对上一次的状态得出转换。这样生命周期
 * 逻辑是纯函数，可以脱离 Electron 单测。
 */
export interface RunRecord {
  id: string;
  serviceId: string;
  /** 当时的显示名：服务可能改名或被删，历史不该跟着变 */
  label: string;
  kind: string;
  startedAt: string;
  endedAt: string | null;
  /** 启动到就绪判定通过的毫秒数；null = 未就绪或还没判定 */
  readyMs: number | null;
  outcome: 'running' | 'stopped' | 'failed';
  returncode: number | null;
  pid: number | null;
  port: number;
  /** 本次见过的最大显存占用（实测优先，否则推算） */
  vramPeakMB: number | null;
  errorText: string | null;
}

/** 一份 ServiceView 是否处于「活着」的状态。 */
function isUp(v: ServiceView): boolean {
  return v.state === 'running' || v.state === 'starting' || v.state === 'restarting';
}

function parseTime(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function iso(t: number): string {
  return new Date(t).toISOString();
}

/**
 * 状态机：把连续的 ServiceView 快照折叠成 Run 列表。纯逻辑，无 IO。
 */
export class RunTracker {
  /** serviceId → 进行中的 Run */
  private open = new Map<string, RunRecord>();
  /** 历史：最新的在前 */
  private records: RunRecord[] = [];
  /** 上一次看到的每个服务是否活着，用于判断转换 */
  private wasUp = new Map<string, boolean>();

  constructor(private limit = 200) {}

  /** 当前全部记录（最新在前） */
  list(): RunRecord[] {
    return this.records;
  }

  /**
   * 用已经存在的历史初始化（从磁盘恢复时用）。
   * 上次没结束的记录**保留**——那是历史，丢掉就再也查不到了；
   * 只把状态降级为已停止，并且**不编造结束时间**（endedAt 留空表示"应用退出时它还在跑"）。
   */
  seed(records: RunRecord[]): void {
    this.records = records.map((r) => (
      r.endedAt === null ? { ...r, outcome: 'stopped' as const, pid: null } : r
    )).slice(0, this.limit);
  }

  /** 删除满足条件的记录（含进行中的），返回删除条数。 */
  forget(pred: (r: RunRecord) => boolean): number {
    for (const [id, run] of [...this.open.entries()]) {
      if (pred(run)) this.open.delete(id);
    }
    const before = this.records.length;
    this.records = this.records.filter((r) => !pred(r));
    return before - this.records.length;
  }

  /**
   * 吸收一次状态快照。返回是否有变化（调用方据此决定要不要落盘）。
   * now 可注入，便于测试。
   */
  observe(views: ServiceView[], now: Date = new Date()): boolean {
    let changed = false;
    const seen = new Set<string>();

    for (const v of views) {
      seen.add(v.id);
      const up = isUp(v);
      const before = this.wasUp.get(v.id);
      const openRun = this.open.get(v.id);
      const startedAt = parseTime(v.startedAt);

      if (up && !openRun) {
        // 开启一条 Run。优先用主进程给的 startedAt：那才是它真正起来的时间
        const run: RunRecord = {
          id: `${v.id}@${v.startedAt ?? now.toISOString()}`,
          serviceId: v.id,
          label: v.label || v.id,
          kind: v.kind,
          startedAt: v.startedAt ?? now.toISOString(),
          endedAt: null,
          readyMs: null,
          outcome: 'running',
          returncode: null,
          pid: v.pid,
          port: v.port,
          vramPeakMB: v.vramActualMB ?? v.vramEstimateMB ?? null,
          errorText: null,
        };
        this.open.set(v.id, run);
        // 立刻进入列表：正在跑的这一次也是运行记录的一部分，
        // 否则"当前这次"要等它结束才看得见。
        this.push(run);
        changed = true;
      }

      const cur = this.open.get(v.id);
      if (cur) {
        // 就绪耗时：第一次看到 healthy 时定下来，之后不再改（否则会被后续刷新越推越大）
        if (cur.readyMs === null && v.healthy && v.state === 'running') {
          const base = parseTime(cur.startedAt) ?? now.getTime();
          cur.readyMs = Math.max(0, now.getTime() - base);
          changed = true;
        }
        const peak = v.vramActualMB ?? v.vramEstimateMB ?? null;
        if (peak !== null && (cur.vramPeakMB === null || peak > cur.vramPeakMB)) {
          cur.vramPeakMB = peak;
          changed = true;
        }
        if (cur.pid !== v.pid) {
          cur.pid = v.pid;
          changed = true;
        }
      }

      // 结束：从活着变成不活着
      if (!up && before === true && cur) {
        this.closeRun(cur, v, now);
        changed = true;
      }

      // 没观察到「活着」就失败了（起得太快，比如 3 秒内退出）：
      // 用主进程给起止时间补一条已结束的记录，否则这种失败会完全没有痕迹。
      if (!up && v.state === 'failed' && before !== true && !this.open.has(v.id)) {
        const s = parseTime(v.startedAt) ?? now.getTime();
        const e = parseTime(v.endedAt) ?? now.getTime();
        const run: RunRecord = {
          id: `${v.id}@${v.startedAt ?? iso(s)}`,
          serviceId: v.id,
          label: v.label || v.id,
          kind: v.kind,
          startedAt: iso(s),
          endedAt: iso(e),
          readyMs: null,
          outcome: 'failed',
          returncode: v.returncode,
          pid: v.pid,
          port: v.port,
          vramPeakMB: v.vramActualMB ?? v.vramEstimateMB ?? null,
          errorText: v.lastError,
        };
        // 同一轮失败只记一条：id 相同就跳过
        if (!this.records.some((r) => r.id === run.id)) {
          this.push(run);
          changed = true;
        }
      }

      this.wasUp.set(v.id, up);
    }

    // 从列表里消失的服务：把它那条 Run 收尾，而不是留一条永远"进行中"
    for (const [id, run] of [...this.open.entries()]) {
      if (seen.has(id)) continue;
      this.closeRun(run, null, now);
      this.wasUp.delete(id);
      changed = true;
    }

    return changed;
  }

  private closeRun(run: RunRecord, v: ServiceView | null, now: Date): void {
    run.endedAt = v?.endedAt ?? iso(now.getTime());
    run.returncode = v?.returncode ?? null;
    run.pid = null;
    run.errorText = v?.lastError ?? run.errorText;
    run.outcome = v && (v.state === 'failed' || (v.returncode !== null && v.returncode !== 0))
      ? 'failed'
      : 'stopped';
    this.open.delete(run.serviceId);
    // 这条记录在开启时就已经进入列表，这里只做定稿
  }

  private push(run: RunRecord): void {
    this.records.unshift(run);
    this.trim();
  }

  /** 从最旧的开始丢，但不丢进行中的那条，否则列表里会看不到当前这次运行。 */
  private trim(): void {
    for (let i = this.records.length - 1; i >= 0 && this.records.length > this.limit; i -= 1) {
      const r = this.records[i];
      if (this.open.get(r.serviceId) === r) continue;
      this.records.splice(i, 1);
    }
  }
}

/**
 * Run 列表的持久化。记录是历史，不是状态：读不出来时按空历史处理，
 * 不影响应用启动；写不进去时也不打断运行（记不下来比崩掉好）。
 */
export class RunLog {
  private tracker: RunTracker;

  constructor(private file: string, limit = 200) {
    this.tracker = new RunTracker(limit);
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as RunRecord[];
      if (Array.isArray(parsed)) this.tracker.seed(parsed);
    } catch { /* 文件损坏时按空历史处理，不阻止启动 */ }
  }

  /** 每次状态广播调用；只有真的变化了才落盘。 */
  observe(views: ServiceView[], now?: Date): void {
    if (!this.tracker.observe(views, now)) return;
    this.persist();
  }

  list(serviceId?: string, limit = 50): RunRecord[] {
    const all = this.tracker.list();
    const filtered = serviceId ? all.filter((r) => r.serviceId === serviceId) : all;
    return filtered.slice(0, limit);
  }

  /** 清空（可按服务）。返回剩下的条数。 */
  clear(serviceId?: string): number {
    this.tracker.forget((r) => (serviceId ? r.serviceId === serviceId : true));
    this.persist();
    return this.tracker.list().length;
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.tracker.list(), null, 2));
    } catch { /* 记不下来比崩掉好 */ }
  }
}
