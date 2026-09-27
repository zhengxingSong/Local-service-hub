import { Settings2 } from 'lucide-react';

interface Props {
  presets: Record<string, string[]>;
  serviceStates: Record<string, string>;
  busy: boolean;
  onStartPreset: (name: string, members: string[]) => void;
  onStopPreset: (name: string, members: string[]) => void;
  onEditPresets: () => void;
}

export function PresetBar({ presets, serviceStates, busy, onStartPreset, onStopPreset, onEditPresets }: Props) {
  return (
    <div className="preset-bar">
      <span className="preset-title">预设组</span>
      {Object.entries(presets).map(([name, members]) => {
        const running = members.filter((m) => serviceStates[m] === 'running').length;
        const total = members.length;
        const active = running > 0;
        return (
          <button
            key={name}
            className={`preset-btn${active ? ' active' : ''}`}
            disabled={busy}
            title={members.join(', ')}
            onClick={() => (running > 0 ? onStopPreset(name, members) : onStartPreset(name, members))}
          >
            {name}
            <span className="preset-count">{running}/{total}</span>
          </button>
        );
      })}
      <button className="preset-edit-btn" title="管理预设组" onClick={onEditPresets}><Settings2 size={14} /></button>
    </div>
  );
}