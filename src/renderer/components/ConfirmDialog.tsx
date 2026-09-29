import { AlertTriangle, Info, X } from 'lucide-react';

export type ConfirmKind =
  | 'delete-service'
  | 'dissolve-group'
  | 'restore-snapshot'
  | 'stop-crashing'
  | 'drop-trial'
  | 'quit';

/** 一次确认请求：kind 决定文案，subject 是"对谁"，onConfirm 是确认后执行的动作。 */
export interface ConfirmRequest {
  kind: ConfirmKind;
  /** 对象名（服务名 / 组名 / 快照时间） */
  subject: string;
  /** 这次特有的补充后果（例如"会从这 2 个组里摘掉"） */
  extra?: string[];
  onConfirm: () => void;
}

interface Copy {
  title: string;
  /** 会发生什么 */
  what: string[];
  /** 明确不会发生什么——危险确认最该说清的部分 */
  not: string[];
  confirm: string;
  danger: boolean;
}

/**
 * 五种以上危险动作的专属文案。
 * 每一条都必须回答两个问题：**会发生什么**、**不会发生什么**；
 * 只说"确定吗"的确认框等于没确认。
 */
function copyOf(req: ConfirmRequest): Copy {
  switch (req.kind) {
    case 'delete-service':
      return {
        title: `删除服务「${req.subject}」`,
        what: [
          '停止它的进程（如果正在运行）',
          '从配置里移除这条服务',
          '把它从所属的预设组里摘掉',
        ],
        not: [
          '不会删除模型文件或任何磁盘上的文件',
          '不会动日志（日志目录里还留着，可自行清理）',
        ],
        confirm: '删除服务',
        danger: true,
      };
    case 'dissolve-group':
      return {
        title: `解散预设组「${req.subject}」`,
        what: [
          '只解除这层组合关系，组名消失',
          '组里的服务各自回到「未分组」',
        ],
        not: [
          '不会删除任何服务',
          '不会停止正在运行的成员（它们继续跑）',
        ],
        confirm: '解散组',
        danger: false,
      };
    case 'restore-snapshot':
      return {
        title: `恢复到 ${req.subject} 的配置快照`,
        what: [
          '当前配置被这份快照覆盖',
          '覆盖前会自动再存一份当前配置（所以这一步可逆）',
          '新配置里不存在的、正在运行的服务会被停止',
        ],
        not: [
          '不会动模型文件与日志',
          '不会影响快照本身',
        ],
        confirm: '恢复并覆盖',
        danger: true,
      };
    case 'stop-crashing':
      return {
        title: `强制停止「${req.subject}」`,
        what: [
          '立即结束进程',
          `它正在反复退出（已重启若干次），停止后不再自动重启`,
        ],
        not: [
          '不会改变配置里的「启用」状态',
          '不会删除任何文件',
        ],
        confirm: '强制停止',
        danger: true,
      };
    case 'drop-trial':
      return {
        title: `丢弃体验服务「${req.subject}」`,
        what: [
          '停止这个临时进程',
          '移除这条临时配置（它从未进入正式服务列表）',
        ],
        not: ['不会删除模型文件'],
        confirm: '丢弃',
        danger: false,
      };
    case 'quit':
      return {
        title: '退出服务中枢',
        what: [
          '关闭窗口与托盘图标',
          '正在运行的服务由各自的策略决定是否随之停止',
        ],
        not: [
          '不会删除配置、日志与模型',
          '下次打开时配置与运行记录都还在',
        ],
        confirm: '退出',
        danger: true,
      };
  }
}

interface Props {
  req: ConfirmRequest;
  onCancel: () => void;
}

export function ConfirmDialog({ req, onCancel }: Props) {
  const c = copyOf(req);
  const items = [...c.what, ...(req.extra ?? [])];

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal confirm">
        <div className="panel-head">
          <span className="panel-title">
            {c.danger && <AlertTriangle size={15} className="ico-bad" />} {c.title}
          </span>
        </div>
        <div className="confirm-body">
          <div className="confirm-sec">
            <div className="confirm-h">会发生什么</div>
            {items.map((t, i) => <div className="confirm-line" key={i}>{t}</div>)}
          </div>
          <div className="confirm-sec">
            <div className="confirm-h">不会发生什么</div>
            {c.not.map((t, i) => <div className="confirm-line muted" key={i}><Info size={12} /> {t}</div>)}
          </div>
        </div>
        <div className="confirm-foot">
          <button className="btn ghost" onClick={onCancel}><X size={13} /> 取消</button>
          <span className="list-spacer" />
          <button
            className={`btn ${c.danger ? 'danger' : 'primary'}`}
            onClick={() => { onCancel(); req.onConfirm(); }}
          >
            {c.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
