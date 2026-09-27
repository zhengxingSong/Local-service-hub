import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { HealthCheck, ModelEntry, ServiceConfig, ServiceKind } from '../types';
import { basename, formatSize } from './ServiceCard';

type HealthMode = 'default' | 'none' | 'tcp' | 'http' | 'openai-models';

interface Props {
  initial: ServiceConfig | null; // null = 新增
  /** 编辑时的原始服务 id：保存必须沿用，否则会把服务改名成空 id */
  initialId: string | null;
  existingIds: string[];
  models: ModelEntry[];
  /** 是否已配置 llama 能力（llama-server 路径或扫描根目录） */
  llamaConfigured: boolean;
  onSave: (id: string, cfg: ServiceConfig) => void;
  onCancel: () => void;
}

interface LlamaForm {
  ctxSize: string;
  ngl: string;
  threads: string;
  parallel: string;
  flashAttn: boolean;
  cacheTypeK: string;
  cacheTypeV: string;
  jinja: boolean;
  extraArgs: string;
}

function newForm(): LlamaForm {
  return { ctxSize: '8192', ngl: '99', threads: '6', parallel: '1', flashAttn: true, cacheTypeK: 'q8_0', cacheTypeV: 'q8_0', jinja: true, extraArgs: '' };
}

function parseArgs(args: string[]): { form: LlamaForm; used: string[] } {
  const form: LlamaForm = newForm();
  const used: string[] = [];
  const get = (flag: string): string | undefined => {
    const i = args.findIndex((a, idx) => a === flag && !used.includes(String(idx)));
    if (i >= 0 && i + 1 < args.length) { used.push(String(i), String(i + 1)); return args[i + 1]; }
    return undefined;
  };
  const has = (flag: string): boolean => {
    const i = args.findIndex((a, idx) => a === flag && !used.includes(String(idx)));
    if (i >= 0) { used.push(String(i)); return true; }
    return false;
  };
  const ctx = get('--ctx-size'); if (ctx) form.ctxSize = ctx;
  const ngl = get('-ngl') ?? get('--gpu-layers'); if (ngl) form.ngl = ngl;
  const threads = get('--threads'); if (threads) form.threads = threads;
  const parallel = get('--parallel'); if (parallel) form.parallel = parallel;
  const ck = get('--cache-type-k'); if (ck) form.cacheTypeK = ck;
  const cv = get('--cache-type-v'); if (cv) form.cacheTypeV = cv;
  const fa = get('--flash-attn');
  if (fa) { form.flashAttn = fa === 'on' || fa === '1' || fa === 'true'; }
  else if (has('--flash-attn')) { form.flashAttn = true; }
  has('--jinja') && (form.jinja = true);
  form.extraArgs = args.filter((_, i) => !used.includes(String(i))).join('\n');
  return { form, used };
}

function buildArgs(form: LlamaForm): string[] {
  const extra = form.extraArgs.split('\n').map((s) => s.trim()).filter(Boolean);
  const tokens = [
    '--ctx-size', form.ctxSize || '8192',
    '-ngl', form.ngl || '99',
    '--threads', form.threads || '6',
    '--parallel', form.parallel || '1',
  ];
  if (form.cacheTypeK) tokens.push('--cache-type-k', form.cacheTypeK);
  if (form.cacheTypeV) tokens.push('--cache-type-v', form.cacheTypeV);
  if (form.flashAttn) tokens.push('--flash-attn', 'on');
  if (form.jinja) tokens.push('--jinja');
  return [...extra, ...tokens];
}

export function ServiceEditor({ initial, initialId, existingIds, models, llamaConfigured, onSave, onCancel }: Props) {
  const initialArgs = initial?.args ?? [];
  const parsed = (() => { try { return parseArgs(initialArgs); } catch { return { form: newForm(), used: [] }; } })();

  const initialKind: ServiceKind = initial?.kind ?? (initial?.composeDir ? 'compose' : initial?.command ? 'command' : 'llama');
  const [mode, setMode] = useState<ServiceKind>(initialKind === 'llama' && !llamaConfigured ? 'command' : initialKind);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [mmproj, setMmproj] = useState(initial?.mmproj ?? '');
  const [alias, setAlias] = useState(initial?.alias ?? '');
  const [port, setPort] = useState(String(initial?.port ?? ''));
  const [form, setForm] = useState<LlamaForm>(parsed.form);
  const [argsText, setArgsText] = useState(initialArgs.join('\n'));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [command, setCommand] = useState(initial?.command ?? '');
  const [cwd, setCwd] = useState(initial?.cwd ?? '');
  const [envText, setEnvText] = useState(
    Object.entries(initial?.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
  );
  const [composeDir, setComposeDir] = useState(initial?.composeDir ?? '');
  const [composeFile, setComposeFile] = useState(initial?.composeFile ?? '');
  const [composeProfilesText, setComposeProfilesText] = useState((initial?.composeProfiles ?? []).join('\n'));
  const [healthMode, setHealthMode] = useState<HealthMode>(initial?.healthCheck?.type ?? 'default');
  const [healthPath, setHealthPath] = useState(
    initial?.healthCheck && 'path' in initial.healthCheck ? initial.healthCheck.path ?? '' : '',
  );
  const [healthStatus, setHealthStatus] = useState(
    initial?.healthCheck?.type === 'http' && initial.healthCheck.expectStatus !== undefined
      ? String(initial.healthCheck.expectStatus)
      : '',
  );
  const [healthBody, setHealthBody] = useState(
    initial?.healthCheck?.type === 'http' ? initial.healthCheck.expectBody ?? '' : '',
  );
  const [healthAlias, setHealthAlias] = useState(
    initial?.healthCheck?.type === 'openai-models' ? initial.healthCheck.expectAlias ?? '' : '',
  );
  const [autostart, setAutostart] = useState(initial?.autostart ?? false);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const mmprojCandidates = Array.from(new Set(models.map((m) => m.siblingMmproj).filter(Boolean))) as string[];

  const onModelPick = (value: string) => {
    setModel(value);
    const entry = models.find((m) => m.path === value);
    if (entry) {
      if (entry.siblingMmproj && !mmproj) setMmproj(entry.siblingMmproj);
      if (!alias) setAlias(entry.name.replace(/\.gguf$/i, ''));
    }
  };

  const parseEnv = (): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const line of envText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return env;
  };

  const parseProfiles = (): string[] =>
    composeProfilesText.split('\n').map((s) => s.trim()).filter(Boolean);

  const buildHealthCheck = (): HealthCheck | undefined => {
    switch (healthMode) {
      case 'default': return undefined;
      case 'none': return { type: 'none' };
      case 'tcp': return { type: 'tcp' };
      case 'http': {
        const status = parseInt(healthStatus, 10);
        return {
          type: 'http',
          path: healthPath.trim() || undefined,
          expectStatus: Number.isFinite(status) ? status : undefined,
          expectBody: healthBody.trim() || undefined,
        };
      }
      case 'openai-models':
        return { type: 'openai-models', path: healthPath.trim() || undefined, expectAlias: healthAlias.trim() || undefined };
    }
  };

  const save = () => {
    const p = parseInt(port, 10);
    if (mode === 'command' && !command.trim()) { setError('命令不能为空'); return; }
    if (mode === 'compose' && !composeDir.trim()) { setError('Compose 目录不能为空'); return; }
    if (mode === 'llama' && !model.trim()) { setError('模型路径不能为空'); return; }
    if (p > 0 && (!Number.isInteger(p) || p < 1 || p > 65535)) { setError('端口必须是 1-65535 的整数（或留空）'); return; }
    if (healthMode === 'http' && healthStatus.trim() && !Number.isFinite(parseInt(healthStatus, 10))) {
      setError('期望状态码必须是整数'); return;
    }
    const fallbackName = mode === 'compose' ? basename(composeDir) : mode === 'command' ? basename(command) : basename(model);
    // 编辑沿用原 id；新增才生成，并在冲突时追加序号
    let id = initialId ?? slug(label || fallbackName);
    if (!initialId) {
      let candidate = id;
      let n = 2;
      while (existingIds.includes(candidate)) candidate = `${id}-${n++}`;
      id = candidate;
    }
    const args = mode === 'llama' ? buildArgs(form) : argsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const common = {
      label: label.trim() || fallbackName,
      role: role.trim(),
      port: p,
      args,
      kind: mode,
      healthCheck: buildHealthCheck(),
      autostart,
      enabled,
    };
    const cfg: ServiceConfig = mode === 'compose'
      ? {
          ...common,
          model: '',
          mmproj: '',
          alias: '',
          composeDir: composeDir.trim(),
          composeFile: composeFile.trim() || undefined,
          composeProfiles: parseProfiles().length > 0 ? parseProfiles() : undefined,
        }
      : mode === 'command'
        ? {
            ...common,
            model: '',
            mmproj: '',
            alias: '',
            command: command.trim(),
            cwd: cwd.trim() || undefined,
            env: Object.keys(parseEnv()).length > 0 ? parseEnv() : undefined,
          }
        : {
            ...common,
            model: model.trim(),
            mmproj: mmproj.trim(),
            alias: alias.trim() || basename(model).replace(/\.gguf$/i, ''),
          };
    onSave(id, cfg);
  };

  const setF = (patch: Partial<LlamaForm>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal">
        <div className="panel-head">
          <span className="panel-title">{initial ? `编辑服务 · ${initial.label}` : '新增服务'}</span>
          <button className="btn small ghost" onClick={onCancel}>取消</button>
        </div>

        <div className="form-row">
          <label>启动方式</label>
          <div className="form-row-group">
            {llamaConfigured && (
              <label className="check-row">
                <input type="radio" name="mode" checked={mode === 'llama'} onChange={() => setMode('llama')} />
                llama 模板（GGUF 模型）
              </label>
            )}
            <label className="check-row">
              <input type="radio" name="mode" checked={mode === 'command'} onChange={() => setMode('command')} />
              自定义命令
            </label>
            <label className="check-row">
              <input type="radio" name="mode" checked={mode === 'compose'} onChange={() => setMode('compose')} />
              Compose 服务（docker compose）
            </label>
          </div>
          {!llamaConfigured && <span className="hint">未配置 llama-server 路径与扫描根目录，llama 模板不可用（可在设置中配置）</span>}
        </div>

        <div className="form-row">
          <label>显示名称</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="可选，默认取模型名/命令名/目录名" />
        </div>

        <div className="form-row">
          <label>角色</label>
          <input className="input" list="role-options" value={role} onChange={(e) => setRole(e.target.value)} placeholder="vlm / embedding / intent / chat / 自定义" />
          <datalist id="role-options">
            <option value="vlm" /><option value="embedding" /><option value="intent" /><option value="chat" />
          </datalist>
          <span className="hint">自由文本，仅用于分组展示</span>
        </div>

        {mode === 'command' ? (
          <>
            <div className="form-row">
              <label>命令（可执行文件）</label>
              <input className="input" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="例如 D:\Python\Python312\python.exe" />
            </div>
            <div className="form-row">
              <label>工作目录（可选）</label>
              <input className="input" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="默认取命令所在目录" />
            </div>
            <div className="form-row">
              <label>环境变量（每行一个 KEY=VALUE，可选）</label>
              <textarea className="textarea" rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="PYTHONUNBUFFERED=1" />
            </div>
          </>
        ) : mode === 'compose' ? (
          <>
            <div className="form-row">
              <label>Compose 目录（含 compose.yaml / docker-compose.yml）</label>
              <input className="input" value={composeDir} onChange={(e) => setComposeDir(e.target.value)} placeholder="例如 D:\deepseek\weknora\deploy" />
            </div>
            <div className="form-row">
              <label>Compose 文件（可选，默认自动发现）</label>
              <input className="input" value={composeFile} onChange={(e) => setComposeFile(e.target.value)} placeholder="例如 docker-compose.yml" />
            </div>
            <div className="form-row">
              <label>--profile 配置（每行一个，可选）</label>
              <textarea className="textarea" rows={3} value={composeProfilesText} onChange={(e) => setComposeProfilesText(e.target.value)} placeholder="例如：neo4j" />
            </div>
          </>
        ) : (
          <>
            <div className="form-row">
              <label>模型（GGUF）</label>
              <input className="input" list="model-options" value={model} onChange={(e) => onModelPick(e.target.value)} placeholder="选择或粘贴路径" />
              <datalist id="model-options">
                {models.map((m) => <option key={m.path} value={m.path}>{`${m.name} (${formatSize(m.sizeBytes)})`}</option>)}
              </datalist>
            </div>
            <div className="form-row">
              <label>视觉投影器 mmproj（可选）</label>
              <input className="input" list="mmproj-options" value={mmproj} onChange={(e) => setMmproj(e.target.value)} />
              <datalist id="mmproj-options">
                {mmprojCandidates.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>

            <div className="param-grid">
              <div className="form-row">
                <label title="KV cache 长度，越大越占显存">上下文 ctx-size</label>
                <input className="input" type="number" min={512} step={512} value={form.ctxSize} onChange={(e) => setF({ ctxSize: e.target.value })} />
                <span className="hint">显存敏感，8192 常见</span>
              </div>
              <div className="form-row">
                <label title="放入显存的层数，99=全部">GPU 层数 ngl</label>
                <input className="input" type="number" min={0} max={999} value={form.ngl} onChange={(e) => setF({ ngl: e.target.value })} />
                <span className="hint">99 = 全量 offload</span>
              </div>
              <div className="form-row">
                <label title="CPU 线程数">线程 threads</label>
                <input className="input" type="number" min={1} max={64} value={form.threads} onChange={(e) => setF({ threads: e.target.value })} />
              </div>
              <div className="form-row">
                <label title="并发槽位数">并行 parallel</label>
                <input className="input" type="number" min={1} max={8} value={form.parallel} onChange={(e) => setF({ parallel: e.target.value })} />
              </div>
              <div className="form-row">
                <label title="Flash Attention 加速长上下文">Flash Attention</label>
                <label className="check-row"><input type="checkbox" checked={form.flashAttn} onChange={(e) => setF({ flashAttn: e.target.checked })} />开启</label>
              </div>
              <div className="form-row">
                <label title="KV cache 量化">Cache K</label>
                <select className="input" value={form.cacheTypeK} onChange={(e) => setF({ cacheTypeK: e.target.value })}>
                  <option value="f16">f16</option>
                  <option value="q8_0">q8_0</option>
                  <option value="q4_0">q4_0</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div className="form-row">
                <label title="KV cache 量化">Cache V</label>
                <select className="input" value={form.cacheTypeV} onChange={(e) => setF({ cacheTypeV: e.target.value })}>
                  <option value="f16">f16</option>
                  <option value="q8_0">q8_0</option>
                  <option value="q4_0">q4_0</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div className="form-row">
                <label title="使用模板对话（chat 模型建议开启）">Jinja 模板</label>
                <label className="check-row"><input type="checkbox" checked={form.jinja} onChange={(e) => setF({ jinja: e.target.checked })} />开启</label>
              </div>
            </div>

            <div className="form-row-group">
              <div className="form-row">
                <label>别名 alias</label>
                <input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="默认取模型文件名" />
              </div>
              <div className="form-row">
                <label>端口</label>
                <input className="input" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
            </div>

            <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showAdvanced ? '收起高级参数' : '高级参数（未识别的原样 args）'}
            </button>
            {showAdvanced && (
              <div className="form-row">
                <label>未识别的原始参数（每行一个，与表单合并后传给 llama-server）</label>
                <textarea className="textarea" rows={5} value={form.extraArgs} onChange={(e) => setF({ extraArgs: e.target.value })} placeholder="--embeddings&#10;--reasoning off" />
                <span className="hint">常见：--embeddings（嵌入模式）、--reasoning off 等</span>
              </div>
            )}
          </>
        )}

        {mode !== 'llama' && (
          <div className="form-row">
            <label>端口（可选，用于状态检测）</label>
            <input className="input" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} placeholder="留空则不检测端口" />
          </div>
        )}

        {mode === 'command' && (
          <div className="form-row">
            <label>启动参数（每行一个）</label>
            <textarea className="textarea" rows={5} value={argsText} onChange={(e) => setArgsText(e.target.value)} />
          </div>
        )}

        <div className="form-row">
          <label title="决定服务卡片显示「就绪中」还是「运行中」">就绪判定</label>
          <select className="input" value={healthMode} onChange={(e) => setHealthMode(e.target.value as HealthMode)}>
            <option value="default">默认（llama 用模型列表，其余用端口）</option>
            <option value="tcp">端口可连接</option>
            <option value="http">HTTP 状态码 / 响应体</option>
            <option value="openai-models">OpenAI /v1/models 模型列表</option>
            <option value="none">不检查</option>
          </select>
          {healthMode === 'http' && (
            <div className="form-row-group">
              <div className="form-row">
                <label>路径</label>
                <input className="input" value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/healthz" />
              </div>
              <div className="form-row">
                <label>期望状态码（可选）</label>
                <input className="input" type="number" value={healthStatus} onChange={(e) => setHealthStatus(e.target.value)} placeholder="默认 2xx/3xx" />
              </div>
              <div className="form-row">
                <label>响应体需包含（可选）</label>
                <input className="input" value={healthBody} onChange={(e) => setHealthBody(e.target.value)} placeholder="支持 {{alias}} {{model}} {{port}}" />
              </div>
            </div>
          )}
          {healthMode === 'openai-models' && (
            <div className="form-row-group">
              <div className="form-row">
                <label>路径</label>
                <input className="input" value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/v1/models" />
              </div>
              <div className="form-row">
                <label>期望模型名（可选）</label>
                <input className="input" value={healthAlias} onChange={(e) => setHealthAlias(e.target.value)} placeholder="默认取 alias，支持 {{alias}}" />
              </div>
            </div>
          )}
        </div>

        <div className="form-row-group">
          <label className="check-row"><input type="checkbox" checked={autostart} onChange={(e) => setAutostart(e.target.checked)} />随应用启动</label>
          <label className="check-row"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />启用</label>
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="form-actions">
          <button className="btn ghost" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}

function slug(text: string): string {
  return (text || 'service')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'service';
}
