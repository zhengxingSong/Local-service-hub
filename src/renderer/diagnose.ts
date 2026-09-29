import { AppConfig, ServiceView } from './types';

/**
 * 归因：从已有的运行证据里判断"问题出在哪一段"，并给出能立刻做的动作。
 *
 * 判据只用主进程真实提供的字段（state / lastError / returncode / 起止时间 /
 * 重启次数 / 端口），不做猜测式动画。**每条结论都要能说出依据**，
 * 说不清时就降低置信度，而不是给一个看起来很确定的错答案。
 *
 * 四个阶段与预检四族是同一套语言：
 * 准备（依赖/环境）→ 启动（进程能不能起来）→ 就绪（起来了能不能用）→ 运行（用着会不会崩）。
 */
export type CauseId = 'ok' | 'ready' | 'start' | 'crash' | 'port' | 'env' | 'resource' | 'disabled' | 'idle';

export type FixId =
  | 'retry'
  | 'stop'
  | 'edit'
  | 'release'
  | 'open-log-dir'
  | 'copy-error'
  | 'enable';

export interface Fix {
  id: FixId;
  label: string;
  /** 动作作用的对象（例如"停掉占用者"要停谁） */
  target?: string;
}

export interface Diagnosis {
  cause: CauseId;
  /** 一段话的结论 */
  title: string;
  /** 判断依据：具体到字段与数值 */
  evidence: string[];
  /** high = 有明确证据；medium = 根据时长/状态推断；low = 只能靠日志 */
  confidence: 'high' | 'medium' | 'low';
  actions: Fix[];
}

/** 按错误文本猜家族。返回 null 表示看不出来（不要硬猜）。 */
function causeFromError(text: string): CauseId | null {
  const t = text.toLowerCase();
  if (/eaddrinuse|address already in use|端口.*(占用|冲突)|listen.*fail/.test(t)) return 'port';
  if (/enoent|not found|cannot find|找不到|no such file|spawn.*fail/.test(t)) return 'env';
  if (/out of memory|oom|cuda|显存|insufficient|memory allocation/.test(t)) return 'resource';
  if (/timeout|timed out|超时|health|ready|就绪/.test(t)) return 'ready';
  if (/exit|returncode|code \d|崩溃|crash/.test(t)) return 'crash';
  return null;
}

function ms(v: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function dur(m: ServiceView): number | null {
  const a = ms(m.startedAt);
  const b = ms(m.endedAt);
  if (a === null || b === null) return null;
  return b - a;
}

function fmtDur(d: number): string {
  if (d < 1000) return `${d} ms`;
  if (d < 60000) return `${(d / 1000).toFixed(1)} 秒`;
  return `${Math.floor(d / 60000)} 分 ${Math.round((d % 60000) / 1000)} 秒`;
}

export interface DiagnoseInput {
  svc: ServiceView;
  config: AppConfig;
  /** 端口 → 占用它的服务名（含正在运行的） */
  portOwners: Record<string, string>;
}

export function diagnose({ svc, config, portOwners }: DiagnoseInput): Diagnosis {
  const evidence: string[] = [];
  const cfg = config.services[svc.id];

  /* 已禁用：这不是故障，是策略 */
  if (!svc.enabled) {
    return {
      cause: 'disabled',
      title: '这个服务在配置里是「已禁用」，不会被启动',
      evidence: ['配置里 enabled=false。禁用只表示"不允许被启动"，与"正在运行"是两个状态位。'],
      confidence: 'high',
      actions: [{ id: 'enable', label: '启用它' }, { id: 'edit', label: '查看配置' }],
    };
  }

  /* 没有异常可归因 */
  if (svc.state === 'running' && svc.healthy) {
    return {
      cause: 'ok',
      title: '运行中且就绪判定已通过',
      evidence: [
        svc.pid ? `进程 pid ${svc.pid}` : '进程在运行',
        svc.port ? `端口 ${svc.port}` : '未声明端口',
        svc.vramActualMB ? `实测占用 ${svc.vramActualMB} MB` : '暂无实测占用',
      ],
      confidence: 'high',
      actions: [{ id: 'stop', label: '停止' }, { id: 'edit', label: '查看配置' }],
    };
  }

  if (svc.state === 'stopped' && !svc.lastError) {
    return {
      cause: 'idle',
      title: '已停止，没有失败记录',
      evidence: ['没有上次错误信息，说明它不是失败退出的。'],
      confidence: 'high',
      actions: [{ id: 'retry', label: '启动它' }, { id: 'edit', label: '查看配置' }],
    };
  }

  /* 还在启动/就绪阶段 */
  if (svc.state === 'loading') {
    const started = ms(svc.startedAt);
    const elapsed = started !== null ? Date.now() - started : null;
    evidence.push('状态是「启动中」：进程已拉起，但就绪判定还没通过。');
    if (elapsed !== null) evidence.push(`已等待 ${fmtDur(elapsed)}。`);
    if (cfg?.healthCheck) evidence.push(`就绪判定方式：${cfg.healthCheck.type}。`);
    return {
      cause: 'ready',
      title: svc.listening
        ? '端口已经在听了，但就绪判定还没通过'
        : '进程已启动，但端口还没开始监听',
      evidence,
      confidence: 'high',
      actions: [
        { id: 'open-log-dir', label: '看日志' },
        { id: 'edit', label: '改就绪判定' },
        { id: 'stop', label: '停止' },
      ],
    };
  }

  /* 正在重启 */
  if (svc.state === 'restarting') {
    return {
      cause: 'crash',
      title: `进程反复退出，正在第 ${svc.restartCount} 次重启`,
      evidence: [
        `重启次数 ${svc.restartCount}${config.maxRestarts ? `（上限 ${config.maxRestarts}）` : ''}。`,
        '重启是自动行为：连续失败到上限后会停下不再重启。',
        ...(svc.returncode !== null ? [`上次退出码 ${svc.returncode}。`] : []),
      ],
      confidence: 'high',
      actions: [
        { id: 'open-log-dir', label: '看日志' },
        { id: 'stop', label: '停止并观察' },
        { id: 'edit', label: '查看配置' },
      ],
    };
  }

  /* failed 或「停下来但留有错误」：这才是真正要归因的情况 */
  const errText = svc.lastError ?? '';
  const byText = errText ? causeFromError(errText) : null;
  const runtime = dur(svc);

  if (errText) evidence.push(`上次错误：${errText}`);
  if (svc.returncode !== null) evidence.push(`退出码 ${svc.returncode}。`);
  if (svc.restartCount > 0) evidence.push(`重启次数 ${svc.restartCount}。`);
  if (runtime !== null) evidence.push(`上次运行了 ${fmtDur(runtime)} 后退出。`);
  if (svc.startedAt && !svc.endedAt) evidence.push('有启动时间但没有结束时间：这一轮可能仍在收尾。');

  /* 端口：配置的端口被别的服务占着，这是能直接看到的证据 */
  const owner = svc.port ? portOwners[String(svc.port)] : undefined;
  const conflict = owner && owner !== (svc.label || svc.id);
  if (conflict) evidence.push(`端口 ${svc.port} 现在被「${owner}」占用。`);

  /* 结论优先级：能直接看到的证据 > 错误文本 > 运行时长推断 */
  if (conflict && (byText === 'port' || byText === null)) {
    return {
      cause: 'port',
      title: `${svc.port} 端口被「${owner}」占着，起不来`,
      evidence,
      confidence: 'high',
      actions: [
        { id: 'release', label: `停掉「${owner}」`, target: Object.keys(config.services).find((id) => (config.services[id].label || id) === owner) },
        { id: 'edit', label: '换个端口' },
        { id: 'open-log-dir', label: '看日志' },
      ],
    };
  }

  if (byText === 'env') {
    return {
      cause: 'env',
      title: '找不到要执行的文件或路径',
      evidence,
      confidence: 'high',
      actions: [
        { id: 'edit', label: '检查路径' },
        { id: 'open-log-dir', label: '看日志' },
      ],
    };
  }

  if (byText === 'resource') {
    return {
      cause: 'resource',
      title: '资源不足导致启动失败',
      evidence: [...evidence, '显存/内存不够时，进程往往在加载阶段就退出。'],
      confidence: 'high',
      actions: [
        { id: 'edit', label: '调小 ctx / 换小模型' },
        { id: 'open-log-dir', label: '看日志' },
      ],
    };
  }

  if (byText === 'ready') {
    return {
      cause: 'ready',
      title: '进程起来了，但没有在预期时间内就绪',
      evidence,
      confidence: 'high',
      actions: [
        { id: 'edit', label: '延长等待或改判定' },
        { id: 'open-log-dir', label: '看日志' },
        { id: 'retry', label: '重试' },
      ],
    };
  }

  /* 用运行时长区分「没起来就退」与「跑了一会儿才崩」——这是最诚实的分界 */
  if (runtime !== null && runtime < 3000) {
    return {
      cause: 'start',
      title: '进程启动后立刻退出（没到 3 秒）',
      evidence: [...evidence, '这种形态通常是路径、参数或缺少运行库，而不是资源问题。'],
      confidence: 'medium',
      actions: [
        { id: 'open-log-dir', label: '看日志' },
        { id: 'edit', label: '检查启动参数' },
        { id: 'retry', label: '重试' },
      ],
    };
  }

  if (runtime !== null && runtime >= 3000) {
    return {
      cause: 'crash',
      title: `运行了 ${fmtDur(runtime)} 后退出`,
      evidence: [...evidence, '起来了才退出，所以更可能是运行期问题（负载、显存碎片、上游断连）。'],
      confidence: 'medium',
      actions: [
        { id: 'open-log-dir', label: '看日志' },
        { id: 'retry', label: '重试' },
        { id: 'edit', label: '查看配置' },
      ],
    };
  }

  return {
    cause: 'start',
    title: svc.lastError ? '启动失败，具体原因需要看日志' : '状态异常，但没有足够的证据归因',
    evidence: [...evidence, '没有运行时长可比对，只能靠日志判断。'],
    confidence: 'low',
    actions: [
      { id: 'open-log-dir', label: '看日志' },
      { id: 'retry', label: '重试' },
      { id: 'edit', label: '查看配置' },
    ],
  };
}
