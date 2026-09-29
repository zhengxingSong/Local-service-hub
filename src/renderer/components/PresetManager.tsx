import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

interface Props {
  presets: Record<string, string[]>;
  allServiceIds: string[];
  /** id → 显示名：成员列表要给人看的名字，不是 slug */
  labels: Record<string, string>;
  exclusivePresets: string[];
  onSave: (presets: Record<string, string[]>, exclusivePresets: string[]) => void;
  onCancel: () => void;
}

/**
 * 预设组编辑。
 *
 * 成员**顺序是语义**，不是排版：启动按序、停止逆序，所以这里用上移/下移显式控制，
 * 而不是复选框——复选框只能表达"在不在组里"，表达不了"谁先起"。
 */
export function PresetManager({ presets, allServiceIds, labels, exclusivePresets, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Record<string, string[]>>(
    Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, [...v]])),
  );
  const [exclusive, setExclusive] = useState<string[]>([...(exclusivePresets ?? [])]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editMembers, setEditMembers] = useState<string[]>([]);

  const labelOf = (id: string): string => labels[id] ?? id;

  const addPreset = () => {
    const name = newName.trim();
    if (!name || draft[name]) return;
    setDraft({ ...draft, [name]: [] });
    setNewName('');
    setEditing(name);
    setEditMembers([]);
  };

  const addMember = (id: string) => setEditMembers((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const dropMember = (id: string) => setEditMembers((prev) => prev.filter((x) => x !== id));

  /** 上移/下移：顺序就是启动顺序，必须能手调 */
  const move = (index: number, dir: -1 | 1) => {
    setEditMembers((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const toggleExclusive = (name: string) => {
    setExclusive((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const saveEditing = () => {
    if (editing === null) return;
    setDraft({ ...draft, [editing]: [...editMembers] });
    setEditing(null);
  };

  const removePreset = (name: string) => {
    const next = { ...draft };
    delete next[name];
    setDraft(next);
    setExclusive((prev) => prev.filter((x) => x !== name));
    if (editing === name) setEditing(null);
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal preset-mgr">
        <div className="panel-head">
          <span className="panel-title">管理预设组</span>
          <span className="list-spacer" />
          <button className="btn small ghost" onClick={onCancel}>关闭</button>
        </div>

        <div className="pm-body">
          <div className="pm-new">
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addPreset(); }}
              placeholder="新预设组名称，例如：写作组"
            />
            <button className="btn" onClick={addPreset}><Plus size={14} /> 新建</button>
          </div>

          {Object.keys(draft).length === 0 && <div className="empty">还没有预设组。一个组就是一个「用途」。</div>}

          {Object.entries(draft).map(([name, members]) => (
            <div key={name} className="pm-item">
              <div className="pm-head">
                <span className="pm-name">{name}</span>
                <span className="pm-count">{members.length} 个成员</span>
                {exclusive.includes(name) && <span className="purpose-exclusive">独占</span>}
                <span className="list-spacer" />
                {editing !== name && (
                  <>
                    <button className="btn small" onClick={() => { setEditing(name); setEditMembers([...members]); }}>
                      编辑成员
                    </button>
                    <button className="btn small danger" onClick={() => removePreset(name)}>删除组</button>
                  </>
                )}
              </div>

              {editing === name ? (
                <div className="pm-edit">
                  <div className="pm-picked">
                    {editMembers.length === 0 && <span className="hint">还没选成员。</span>}
                    {editMembers.map((id, i) => (
                      <div className="pm-row" key={id}>
                        <span className="member-ord">{i + 1}</span>
                        <span className="pm-label">{labelOf(id)}</span>
                        <span className="pm-ops">
                          <button className="btn small ghost" disabled={i === 0} title="上移（更早启动）" onClick={() => move(i, -1)}>
                            <ArrowUp size={13} />
                          </button>
                          <button
                            className="btn small ghost"
                            disabled={i === editMembers.length - 1}
                            title="下移（更晚启动）"
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button className="btn small ghost" title="移出本组" onClick={() => dropMember(id)}>
                            <X size={13} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pm-avail">
                    <span className="hint">可加入的服务</span>
                    {allServiceIds.filter((id) => !editMembers.includes(id)).length === 0
                      ? <span className="hint">都已经在组里了。</span>
                      : allServiceIds.filter((id) => !editMembers.includes(id)).map((id) => (
                          <button className="btn small" key={id} onClick={() => addMember(id)}>+ {labelOf(id)}</button>
                        ))}
                  </div>

                  <span className="hint">
                    顺序就是启动顺序，停止时逆序——靠后的成员要用到靠前的能力，所以别把顺序当排版。
                  </span>
                  <div className="pm-edit-foot">
                    <button className="btn small ghost" onClick={() => setEditing(null)}>取消编辑</button>
                    <button className="btn small primary" onClick={saveEditing}>保存成员</button>
                  </div>
                </div>
              ) : (
                <div className="member-list">
                  {members.length === 0 && <div className="member"><span className="member-state">（空组）</span></div>}
                  {members.map((m, i) => (
                    <div className="member" key={m}>
                      <span className="member-ord">{i + 1}</span>
                      <span className="member-name">{labelOf(m)}</span>
                    </div>
                  ))}
                </div>
              )}

              <label className="check-row pm-excl">
                <input
                  type="checkbox"
                  checked={exclusive.includes(name)}
                  onChange={() => toggleExclusive(name)}
                />
                独占运行（启动本组时先确认停止其他正在运行的组）
              </label>
            </div>
          ))}
        </div>

        <div className="pm-foot">
          <span className="hint">
            组级「随应用启动」还没做：当前只有单个服务的自启（在服务编辑的策略段）。
          </span>
          <span className="list-spacer" />
          <button className="btn ghost" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={() => onSave(draft, exclusive)}>保存全部</button>
        </div>
      </div>
    </div>
  );
}
