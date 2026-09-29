import { Check, RefreshCw, ShieldAlert } from 'lucide-react';
import { PreflightAction, PreflightResult } from '../preflight';

interface Props {
  result: PreflightResult;
  busy: boolean;
  onAction: (action: PreflightAction) => void;
  onRecheck: () => void;
  onForce: () => void;
  onCancel: () => void;
}

/**
 * 预检决策面：启动之前的裁决，不是错误弹窗。
 *
 * 三条出口是固定的：① 就地修（每族给的动作）② 重新预检 ③ 强制启动（按降级启动）。
 * 通过的族只占一行——四族都展开会把真正有问题的那族埋掉。
 */
export function PreflightDialog({ result, busy, onAction, onRecheck, onForce, onCancel }: Props) {
  const blocked = result.items.filter((i) => !i.ok);
  const passed = result.items.filter((i) => i.ok);

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal pf">
        <div className="panel-head">
          <span className="panel-title">启动预检 · {result.target.label}</span>
          <span className={`pf-badge ${blocked.length > 0 ? 'bad' : 'ok'}`}>
            {blocked.length > 0 ? `${blocked.length} 族待处理` : '四族通过'}
          </span>
          <span className="list-spacer" />
          <button className="btn small ghost" onClick={onCancel}>取消</button>
        </div>

        <div className="pf-body">
          {blocked.length === 0 && (
            <div className="pf-clean">
              <Check size={14} className="ico-ok" /> 四族都没有问题，可以直接启动。
            </div>
          )}

          {blocked.map((item) => (
            <section className="pf-fam bad" key={item.id}>
              <div className="pf-fam-h">
                <span className="sec-no">{item.no}</span>
                <span className="pf-fam-t">{item.title}</span>
                <span className="pf-badge bad">待处理</span>
                <span className="pf-src">来源：{item.source}</span>
              </div>
              <div className="pf-fam-b">
                <div className="pf-line bad">{item.summary}</div>
                {item.details.map((d, i) => <div className="pf-detail" key={i}>{d}</div>)}
                {item.actions.length > 0 ? (
                  <div className="pf-acts">
                    {item.actions.map((a, i) => (
                      <button key={i} className="btn small" disabled={busy} onClick={() => onAction(a)}>{a.label}</button>
                    ))}
                  </div>
                ) : (
                  <div className="pf-detail">这一族没有能立刻做的动作——只能改配置或强制启动。</div>
                )}
              </div>
            </section>
          ))}

          {passed.length > 0 && (
            <div className="pf-passed">
              {passed.map((item) => (
                <div className="pf-pass-row" key={item.id}>
                  <Check size={13} className="ico-ok" />
                  <span className="pf-fam-t">{item.no} {item.title}</span>
                  <span className="pf-line">{item.summary}</span>
                  <span className="pf-src">{item.source}</span>
                </div>
              ))}
            </div>
          )}

          {blocked.some((b) => b.id === 'res' && !b.ok) && (
            <div className="pf-note">
              资源这一族不会因为"重试"变好：要么停掉占用者，要么把需求降下来。
              强制启动不会让显存变多，只会让进程在加载时失败——那种失败更难查。
            </div>
          )}
        </div>

        <div className="pf-foot">
          <button className="btn ghost" onClick={onRecheck} disabled={busy}>
            <RefreshCw size={13} /> 重新预检
          </button>
          <span className="list-spacer" />
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn danger" onClick={onForce} disabled={busy}>
            <ShieldAlert size={13} /> 仍然启动
          </button>
        </div>
      </div>
    </div>
  );
}
