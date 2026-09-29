import { useState } from 'react';
import { FolderSearch, Search, Package, Boxes, Server, HelpCircle } from 'lucide-react';
import { ProbeResult } from '../types';

interface Props {
  onPick: () => Promise<string | null>;
  onInspect: (path: string) => Promise<ProbeResult>;
  /** 用这个形态继续：带着建议值进入服务编辑 */
  onUse: (result: ProbeResult) => void;
  /** 不探测，直接手填 */
  onSkip: () => void;
  onCancel: () => void;
}

const KIND_LABEL: Record<ProbeResult['kind'], string> = {
  llama: '模型服务',
  command: '源代码部署',
  compose: 'docker 应用',
  unknown: '判断不出来',
  missing: '路径有问题',
};

function KindIcon({ kind }: { kind: ProbeResult['kind'] }) {
  if (kind === 'llama') return <Server size={15} />;
  if (kind === 'command') return <FolderSearch size={15} />;
  if (kind === 'compose') return <Boxes size={15} />;
  return <HelpCircle size={15} />;
}

/**
 * 探测：选目录 → 判断形态 → 用这个形态继续。
 *
 * 为什么要有这一步：用户手里只有一个目录路径，而纳管它需要先知道它是
 * 模型目录、Compose 项目还是源代码项目——选错形态，后面六段的字段全不对。
 * 判断依据逐条摆出来，认不出来就说认不出来。
 */
export function ProbeDialog({ onPick, onInspect, onUse, onSkip, onCancel }: Props) {
  const [path, setPath] = useState('');
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string>('');

  const inspect = async (p: string) => {
    if (!p.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await onInspect(p.trim());
      setResult(r);
      setChosen(r.suggestion.model ?? '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    setBusy(true);
    setErr(null);
    try {
      const picked = await onPick();
      if (picked) {
        setPath(picked);
        await inspect(picked);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 把选中的候选（多模型时）并入建议值 */
  const effective = (): ProbeResult | null => {
    if (!result) return null;
    if (!chosen || result.kind !== 'llama') return result;
    const mmproj = result.suggestion.mmproj && chosen === result.suggestion.model
      ? result.suggestion.mmproj
      : undefined;
    return { ...result, suggestion: { ...result.suggestion, model: chosen, mmproj } };
  };

  const canUse = result && (result.kind === 'llama' || result.kind === 'command' || result.kind === 'compose');

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal probe">
        <div className="panel-head">
          <span className="panel-title"><Package size={15} /> 这个目录是什么？</span>
          <span className="list-spacer" />
          <button className="btn small ghost" onClick={onCancel}>取消</button>
        </div>

        <div className="probe-body">
          <div className="probe-step">
            <span className="sec-no">①</span> 选一个目录
          </div>
          <div className="probe-pick">
            <input
              className="input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="例如 E:\weknora 或 D:\LLM Model\llama.cpp\models"
              onKeyDown={(e) => { if (e.key === 'Enter') void inspect(path); }}
            />
            <button className="btn" disabled={busy} onClick={() => void pick()}>
              <FolderSearch size={14} /> 浏览…
            </button>
            <button className="btn primary" disabled={busy || !path.trim()} onClick={() => void inspect(path)}>
              <Search size={14} /> 探测
            </button>
          </div>
          <span className="hint">
            探测只看目录结构与标志文件，不改动任何东西；模型服务会顺便配上同目录的 mmproj。
          </span>

          {err && <div className="banner error">{err}</div>}

          {result && (
            <>
              <div className="probe-step">
                <span className="sec-no">②</span> 判断结果
                <span className={`kind-badge kind-${result.kind}`}>
                  <KindIcon kind={result.kind} /> {KIND_LABEL[result.kind]}
                </span>
              </div>

              <div className="probe-ev">
                <div className="probe-ev-h">判断依据</div>
                {result.evidence.map((e, i) => <div className="probe-ev-line" key={i}>{e}</div>)}
              </div>

              {result.candidates.length > 1 && (
                <div className="form-row">
                  <label>这个目录里有多个模型，用哪一个？</label>
                  <select className="input" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                    {result.candidates.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              )}

              {(result.suggestion.port || result.suggestion.composeProfiles?.length) && (
                <div className="probe-sug">
                  {result.suggestion.port ? <span className="cfg-flag ok">建议端口 {result.suggestion.port}</span> : null}
                  {result.suggestion.composeProfiles?.length
                    ? <span className="cfg-flag ok">profiles {result.suggestion.composeProfiles.join('、')}</span>
                    : null}
                  <span className="hint">这些是从文件里读出来的，下一步可以改。</span>
                </div>
              )}

              {result.kind === 'unknown' && (
                <div className="probe-note">
                  没找到可识别的标志文件。你可以直接手填一条服务——比让工具猜一个错的形态更快。
                </div>
              )}
            </>
          )}
        </div>

        <div className="probe-foot">
          <button className="btn ghost" onClick={onSkip}>不探测，直接手填</button>
          <span className="list-spacer" />
          <button className="btn" onClick={onCancel}>取消</button>
          <button
            className="btn primary"
            disabled={!canUse}
            onClick={() => { const r = effective(); if (r) onUse(r); }}
          >
            用这个形态继续
          </button>
        </div>
      </div>
    </div>
  );
}
