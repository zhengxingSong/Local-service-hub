import { useState } from 'react';
import { Trash2, Plus, Pencil } from 'lucide-react';

interface Props {
  presets: Record<string, string[]>;
  allServiceIds: string[];
  exclusivePresets: string[];
  onSave: (presets: Record<string, string[]>, exclusivePresets: string[]) => void;
  onCancel: () => void;
}

export function PresetManager({ presets, allServiceIds, exclusivePresets, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Record<string, string[]>>(
    Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, [...v]])),
  );
  const [exclusive, setExclusive] = useState<string[]>([...(exclusivePresets ?? [])]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editMembers, setEditMembers] = useState<string[]>([]);

  const addPreset = () => {
    const name = newName.trim();
    if (!name || draft[name]) return;
    setDraft({ ...draft, [name]: [] });
    setNewName('');
    setEditing(name);
    setEditMembers([]);
  };

  const toggleMember = (id: string) => {
    setEditMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleExclusive = (name: string) => {
    setExclusive((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const saveEditing = () => {
    if (editing === null) return;
    const next = { ...draft, [editing]: [...editMembers] };
    setDraft(next);
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
      <div className="modal" style={{ width: 560 }}>
        <div className="panel-head">
          <span className="panel-title">管理预设组</span>
          <button className="btn small ghost" onClick={onCancel}>关闭</button>
        </div>

        <div className="form-row">
          <label>新预设组名称</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPreset(); }} placeholder="例如：写作组" />
            <button className="btn" onClick={addPreset}><Plus size={14} /> 添加</button>
          </div>
        </div>

        <div className="preset-manager">
          {Object.entries(draft).map(([name, members]) => (
            <div key={name} className="preset-item">
              {editing === name ? (
                <>
                  <span className="name">{name}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 280 }}>
                    {allServiceIds.map((id) => (
                      <label key={id} className="check-row" style={{ fontSize: 12 }}>
                        <input type="checkbox" checked={editMembers.includes(id)} onChange={() => toggleMember(id)} />
                        {id}
                      </label>
                    ))}
                  </div>
                  <button className="btn small primary" onClick={saveEditing}>保存</button>
                </>
              ) : (
                <>
                  <span className="name">{name}</span>
                  <span className="members">
                    {members.length > 0 ? members.map((m) => <span key={m} className="chip">{m}</span>) : '（空）'}
                  </span>
                  <label className="check-row" style={{ fontSize: 12, whiteSpace: 'nowrap' }} title="启动该组时提示停止其他运行中的组">
                    <input type="checkbox" checked={exclusive.includes(name)} onChange={() => toggleExclusive(name)} />
                    独占运行
                  </label>
                  <button className="btn small" onClick={() => { setEditing(name); setEditMembers([...members]); }}><Pencil size={13} /> 编辑</button>
                  <button className="btn small danger" onClick={() => removePreset(name)}><Trash2 size={13} /> 删除</button>
                </>
              )}
            </div>
          ))}
          {Object.keys(draft).length === 0 && <div className="empty">还没有预设组</div>}
        </div>

        <div className="hint">「独占运行」的组启动时会提示停止其他运行中的组（避免显存/端口冲突）。</div>

        <div className="form-actions">
          <button className="btn ghost" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={() => onSave(draft, exclusive)}>保存全部</button>
        </div>
      </div>
    </div>
  );
}