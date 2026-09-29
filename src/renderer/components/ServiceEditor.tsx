import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Check, AlertTriangle } from 'lucide-react';
import { HealthCheck, ModelEntry, ServiceConfig, ServiceKind } from '../types';
import { basename, formatSize } from './ServiceCard';

type HealthMode = 'default' | 'none' | 'tcp' | 'http' | 'openai-models';
type Sec = 'form' | 'prep' | 'start' | 'ready' | 'req' | 'policy';

interface Props {
  initial: ServiceConfig | null; // null = 新增
  /** 编辑时的原始服务 id：保存必须沿用，否则会把服务改名成空 id */
  initialId: string | null;
  existingIds: string[];
  models: ModelEntry[];
  /** 是否已配置 llama 能力（llama-server 路径或扫描根目录） */
  llamaConfigured: boolean;
  /** 端口 → 占用它的服务名（用于在「暴露与就绪」段做冲突提醒） */
  portOwners: Record<string, string>;
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

const SECTIONS: { id: Sec; no: string; name: string }[] = [
  { id: 'form', no: '①', name: '形态' },
  { id: 'prep', no: '②', name: '准备' },
  { id: 'start', no: '③', name: '启动' },
  { id: 'ready', no: '④', name: '暴露与就绪' },
  { id: 'req', no: '⑤', name: '需求' },
  { id: 'policy', no: '⑥', name: '策略' },
];

/**
 * 服务编辑（二级页）：六段结构 + 左段导航 + 校验摘要。
 *
 * 与 ui-l2-carbon.html 的口径一致——配置闭环的判据是「试运行通过」而不是「保存成功」，
 * 所以左栏常驻「校验摘要」，问题项可点并跳到对应段；保存只拦阻断级问题。
 */
export function ServiceEditor({
  initial, initialId, existingIds, models, llamaConfigured, portOwners, onSave, onCancel,
}: Props) {
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
  const [active, setActive] = useState<Sec>('form');

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

  /** 端口被「别的服务」占用：编辑自己时不算冲突 */
  const portOwnerOther = (() => {
    const p = port.trim();
    if (!p) return undefined;
    const owner = portOwners[p];
    if (!owner || owner === (initial?.label ?? '')) return undefined;
    return owner;
  })();

  /** 校验摘要：阻断级问题会拦住保存；提醒级只提示 */
  const issues = useMemo(() => {
    const list: { sec: Sec; text: string; block: boolean }[] = [];
    if (mode === 'command' && !command.trim()) list.push({ sec: 'start', text: '命令不能为空', block: true });
    if (mode === 'compose' && !composeDir.trim()) list.push({ sec: 'start', text: 'Compose 目录不能为空', block: true });
    if (mode === 'llama' && !model.trim()) list.push({ sec: 'start', text: '模型路径不能为空', block: true });

    const p = parseInt(port, 10);
    if (port.trim() && (!Number.isInteger(p) || p < 1 || p > 65535)) {
      list.push({ sec: 'ready', text: '端口必须是 1–65535 的整数', block: true });
    }
    if (healthMode === 'http' && healthStatus.trim() && !Number.isFinite(parseInt(healthStatus, 10))) {
      list.push({ sec: 'ready', text: '期望状态码必须是整数', block: true });
    }

    // 提醒级
    if (portOwnerOther) {
      list.push({ sec: 'ready', text: `端口 ${port.trim()} 已被「${portOwnerOther}」占用`, block: false });
    }
    if (!port.trim() && mode !== 'compose') {
      list.push({ sec: 'ready', text: '未填端口：无法做端口占用检测与就绪判定', block: false });
    }
    if (mode === 'llama' && model.trim() && !mmproj.trim() && /vl|vision|llava/i.test(model)) {
      list.push({ sec: 'start', text: '模型名像多模态，但未选择 mmproj 投影器', block: false });
    }
    if (mode === 'llama' && model.trim() && /\\\\/.test(model)) {
      list.push({ sec: 'start', text: '模型路径含重复反斜杠（手改配置的痕迹，建议修正）', block: false });
    }
    if (healthMode === 'default') {
      list.push({ sec: 'ready', text: '就绪判定用默认值：llama 走模型列表，其余走端口', block: false });
    }
    return list;
  }, [mode, command, composeDir, model, mmproj, port, healthStatus, healthMode, portOwnerOther]);

  const blockers = issues.filter((i) => i.block);
  const passCount = 6 - new Set(issues.filter((i) => i.block).map((i) => i.sec)).size;

  const jumpTo = (sec: Sec) => {
    setActive(sec);
    const el = document.getElementById(`sec-${sec}`);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const save = () => {
    const p = parseInt(port, 10);
    if (mode === 'command' && !command.trim()) { setError('命令不能为空'); jumpTo('start'); return; }
    if (mode === 'compose' && !composeDir.trim()) { setError('Compose 目录不能为空'); jumpTo('start'); return; }
    if (mode === 'llama' && !model.trim()) { setError('模型路径不能为空'); jumpTo('start'); return; }
    if (p > 0 && (!Number.isInteger(p) || p < 1 || p > 65535)) { setError('端口必须是 1-65535 的整数（或留空）'); jumpTo('ready'); return; }
    if (healthMode === 'http' && healthStatus.trim() && !Number.isFinite(parseInt(healthStatus, 10))) {
      setError('期望状态码必须是整数'); jumpTo('ready'); return;
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
    <div className="edit">
      <div className="edit-h">
        <button className="btn small ghost" onClick={onCancel}>← 返回</button>
        <span className="edit-title">{initial ? initial.label || initialId : '新增服务'}</span>
        <span className="kind-badge">{KIND[mode]}</span>
        <span className="list-spacer" />
        {blockers.length === 0
          ? <span className="cfg-flag ok">校验通过</span>
          : <span className="cfg-flag bad">{blockers.length} 项待处理</span>}
        <button className="btn primary small" onClick={save} disabled={blockers.length > 0}>保存</button>
      </div>

      <div className="edit-b">
        <nav className="edit-nav">
          {SECTIONS.map((s) => {
            const secIssues = issues.filter((i) => i.sec === s.id);
            const bad = secIssues.some((i) => i.block);
            return (
              <button
                key={s.id}
                className={`nav-i${active === s.id ? ' on' : ''}`}
                onClick={() => jumpTo(s.id)}
              >
                <span className="nav-no">{s.no}</span>
                <span>{s.name}</span>
                <span className="nav-st">
                  {bad
                    ? <AlertTriangle size={12} className="ico-bad" />
                    : <Check size={12} className="ico-ok" />}
                </span>
              </button>
            );
          })}
          <div className="nav-sum">
            <div className="nav-sum-head">校验摘要</div>
            <div className="nav-sum-line">6 段中 {passCount} 段无阻断</div>
            {issues.length === 0 && <div className="nav-sum-ok">没有发现问题</div>}
            {issues.map((i, idx) => (
              <button
                key={idx}
                className={`nav-issue${i.block ? ' bad' : ''}`}
                onClick={() => jumpTo(i.sec)}
                title="跳到该段"
              >
                {i.block ? '✕' : '!'} {i.text}
              </button>
            ))}
          </div>
        </nav>

        <div className="edit-form">
          {/* ① 形态 */}
          <section className="sec" id="sec-form">
            <div className="sec-h"><span className="sec-no">①</span> 形态<span className="sec-note">决定其余五段的字段</span></div>
            <div className="sec-b">
              <div className="form-row-group">
                {llamaConfigured && (
                  <label className="check-row">
                    <input type="radio" name="mode" checked={mode === 'llama'} onChange={() => setMode('llama')} />
                    模型服务（GGUF）
                  </label>
                )}
                <label className="check-row">
                  <input type="radio" name="mode" checked={mode === 'command'} onChange={() => setMode('command')} />
                  源代码部署
                </label>
                <label className="check-row">
                  <input type="radio" name="mode" checked={mode === 'compose'} onChange={() => setMode('compose')} />
                  docker 应用
                </label>
              </div>
              {!llamaConfigured && (
                <span className="hint">未配置 llama-server 路径与扫描根目录，模型服务不可选（可在「设置」里配置）。</span>
              )}
            </div>
          </section>

          {/* ② 准备 */}
          <section className="sec" id="sec-prep">
            <div className="sec-h"><span className="sec-no">②</span> 准备<span className="sec-note">当前版本尚未支持</span></div>
            <div className="sec-b">
              <span className="hint">
                三类形态的准备动作不同：docker 应用要拉取/构建镜像，源代码部署要装依赖，模型服务要取模型并校验。
                本版本还不支持在应用内执行准备步骤——依赖需要你自己先准备好。
                这是「源代码部署」这个词真正落地的地方，计划在 M6 实现。
              </span>
            </div>
          </section>

          {/* ③ 启动 */}
          <section className="sec" id="sec-start">
            <div className="sec-h"><span className="sec-no">③</span> 启动</div>
            <div className="sec-b">
              <div className="form-row-group">
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
                </div>
              </div>

              {mode === 'command' ? (
                <>
                  <div className="form-row">
                    <label>可执行文件</label>
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
                  <div className="form-row">
                    <label>启动参数（每行一个）</label>
                    <textarea className="textarea" rows={5} value={argsText} onChange={(e) => setArgsText(e.target.value)} />
                  </div>
                </>
              ) : mode === 'compose' ? (
                <>
                  <div className="form-row">
                    <label>Compose 目录（含 compose.yaml / docker-compose.yml）</label>
                    <input className="input" value={composeDir} onChange={(e) => setComposeDir(e.target.value)} placeholder="例如 E:\weknora" />
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

                  <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
                    {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showAdvanced ? '收起高级参数' : '高级参数（未识别的原样 args）'}
                  </button>
                  {showAdvanced && (
                    <div className="form-row">
                      <label>未识别的原始参数（每行一个，与表单合并后传给 llama-server）</label>
                      <textarea className="textarea" rows={5} value={form.extraArgs} onChange={(e) => setF({ extraArgs: e.target.value })} placeholder="--embeddings&#10;--reasoning off" />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ④ 暴露与就绪 */}
          <section className="sec" id="sec-ready">
            <div className="sec-h"><span className="sec-no">④</span> 暴露与就绪<span className="sec-note">进程起来 ≠ 能力可用</span></div>
            <div className="sec-b">
              <div className="form-row-group">
                <div className="form-row">
                  <label>端口</label>
                  <input className="input" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} placeholder={mode === 'compose' ? '可选' : '例如 11435'} />
                </div>
                <div className="form-row">
                  <label>别名 alias</label>
                  <input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="默认取模型文件名" />
                </div>
              </div>
              {portOwnerOther && (
                <div className="banner error">端口 {port.trim()} 已被「{portOwnerOther}」占用，启动会失败或撞车。</div>
              )}

              <div className="form-row">
                <label title="决定是显示「就绪中」还是「运行中」">就绪判定</label>
                <select className="input" value={healthMode} onChange={(e) => setHealthMode(e.target.value as HealthMode)}>
                  <option value="default">默认（模型服务走模型列表，其余走端口）</option>
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
            </div>
          </section>

          {/* ⑤ 需求 */}
          <section className="sec" id="sec-req">
            <div className="sec-h"><span className="sec-no">⑤</span> 需求<span className="sec-note">预检的四族条件</span></div>
            <div className="sec-b">
              <div className="kv">
                <span className="k">环境</span>
                <span className="v">
                  {mode === 'llama' ? (model ? basename(model) : '（未选模型）') : mode === 'command' ? (command || '（未填命令）') : (composeDir || '（未填目录）')}
                </span>
                <span className="k">资源</span>
                <span className="v">
                  {mode === 'llama'
                    ? '显存：保存后按 GGUF 与 ctx/ngl 推算（推算值）'
                    : '内存/显存：源码与容器类无法推算，需要你声明（当前版本未提供声明入口）'}
                </span>
                <span className="k">占用</span>
                <span className="v">{port.trim() ? `端口 ${port.trim()}${portOwnerOther ? `（已被「${portOwnerOther}」占用）` : '（当前空闲）'}` : '未声明端口'}</span>
                <span className="k">依赖</span>
                <span className="v">未声明（当前版本只能靠预设组的成员顺序表达依赖）</span>
              </div>
              <span className="hint">
                需求是启动前预检的输入。每条都应标注来源：<b>推算</b>（模型服务可由 GGUF 与参数算出）、
                <b>读取</b>（compose 里声明的端口与内存）、<b>声明</b>（源码启动只能由你填）。
                三者混用同一视觉，比不做预检更危险。
              </span>
            </div>
          </section>

          {/* ⑥ 策略 */}
          <section className="sec" id="sec-policy">
            <div className="sec-h"><span className="sec-no">⑥</span> 策略</div>
            <div className="sec-b">
              <div className="form-row-group">
                <label className="check-row"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />启用（配置上允许被启动）</label>
                <label className="check-row"><input type="checkbox" checked={autostart} onChange={(e) => setAutostart(e.target.checked)} />随应用启动</label>
              </div>
              <span className="hint">
                「启用」与「正在运行」是两个不同的状态位：启用只是允许被启动。
                归属组在「配置 → 预设组」里维护（一个服务可以属于多个组；停组时被共用成员会单独提示）。
              </span>
            </div>
          </section>

          {error && <div className="banner error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

const KIND: Record<ServiceKind, string> = {
  llama: '模型服务',
  command: '源代码部署',
  compose: 'docker 应用',
};

function slug(text: string): string {
  return (text || 'service')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'service';
}
