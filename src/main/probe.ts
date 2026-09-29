import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * 探测：给一个目录，判断它「是什么形态」，并把判断依据摆出来。
 *
 * 这一步存在的理由：用户手里只有一个目录路径，而纳管它需要先知道
 * 它是模型目录、Compose 项目还是源代码项目——选错形态，后面六段的字段全不对。
 *
 * 每条结论都必须带**可核对的依据**（找到了哪个文件、几个文件）。
 * 看不出来就说看不出来，**不猜**：猜错的形态会让用户在错误的表单里填半天。
 */
export type ProbeKind = 'llama' | 'command' | 'compose' | 'unknown' | 'missing';

export interface ProbeSuggestion {
  label?: string;
  model?: string;
  mmproj?: string;
  command?: string;
  cwd?: string;
  composeDir?: string;
  composeFile?: string;
  composeProfiles?: string[];
  port?: number;
}

export interface ProbeResult {
  path: string;
  kind: ProbeKind;
  /** 判断依据：每条都能自己去目录里核对 */
  evidence: string[];
  /** 该形态下可直接采用的建议值；不确定的字段一律不填 */
  suggestion: ProbeSuggestion;
  /** 多项可选时列出候选（例如目录里有多个 GGUF） */
  candidates: { label: string; value: string }[];
}

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

/** 源代码项目的标志文件 → 建议的解释器/运行时 */
const CODE_MARKERS: { file: string; runtime: string; label: string }[] = [
  { file: 'requirements.txt', runtime: 'python', label: 'Python（requirements.txt）' },
  { file: 'pyproject.toml', runtime: 'python', label: 'Python（pyproject.toml）' },
  { file: 'main.py', runtime: 'python', label: 'Python（main.py）' },
  { file: 'app.py', runtime: 'python', label: 'Python（app.py）' },
  { file: 'server.py', runtime: 'python', label: 'Python（server.py）' },
  { file: 'package.json', runtime: 'node', label: 'Node.js（package.json）' },
  { file: 'go.mod', runtime: 'go', label: 'Go（go.mod）' },
  { file: 'Cargo.toml', runtime: 'cargo', label: 'Rust（Cargo.toml）' },
];

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 在目录里递归找 *.gguf（限两层，避免在大盘上乱跑）。 */
function findGguf(dir: string, depth = 2): string[] {
  const out: string[] = [];
  const walk = (d: string, left: number): void => {
    for (const name of safeList(d)) {
      const full = join(d, name);
      if (isDir(full)) {
        if (left > 0) walk(full, left - 1);
        continue;
      }
      if (name.toLowerCase().endsWith('.gguf')) out.push(full);
    }
  };
  walk(dir, depth);
  return out;
}

/** 从 compose 文本里粗略取主机端口与 profiles——是启发式，不作为承诺。 */
function parseCompose(text: string): { port?: number; profiles: string[] } {
  const profiles: string[] = [];
  let port: number | undefined;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const portMatch = line.match(/^\s*-\s*"?(\d{2,5}):\d{1,5}"?\s*$/);
    if (portMatch && port === undefined) {
      port = Number(portMatch[1]);
    }
    const profInline = line.match(/^\s*profiles:\s*\[(.*)\]\s*$/);
    if (profInline) {
      for (const p of profInline[1].split(',')) {
        const v = p.trim().replace(/^["']|["']$/g, '');
        if (v) profiles.push(v);
      }
      continue;
    }
    if (/^\s*profiles:\s*$/.test(line)) {
      // 列表形式：往下读到缩进变浅为止
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = lines[j].match(/^\s*-\s*(.+?)\s*$/);
        if (!item) break;
        const v = item[1].replace(/^["']|["']$/g, '');
        if (v) profiles.push(v);
      }
    }
  }
  return { port, profiles };
}

export function inspectPath(input: string, depth = 2): ProbeResult {
  const path = (input ?? '').trim();
  if (!path) {
    return { path, kind: 'missing', evidence: ['还没有填路径。'], suggestion: {}, candidates: [] };
  }
  if (!existsSync(path)) {
    return { path, kind: 'missing', evidence: [`路径不存在：${path}`], suggestion: {}, candidates: [] };
  }
  if (!isDir(path)) {
    return { path, kind: 'missing', evidence: ['这个路径不是目录。模型文件请用「服务编辑 → 启动 → 模型」直接选。'], suggestion: {}, candidates: [] };
  }

  const names = safeList(path);
  const evidence: string[] = [];
  const label = basename(path);

  /* ① Compose：最明确的信号（文件名固定） */
  const composeFile = COMPOSE_FILES.find((f) => names.includes(f));
  if (composeFile) {
    evidence.push(`目录里有 ${composeFile}。`);
    let port: number | undefined;
    let profiles: string[] = [];
    try {
      const parsed = parseCompose(readFileSync(join(path, composeFile), 'utf-8'));
      port = parsed.port;
      profiles = parsed.profiles;
      if (port) evidence.push(`从 ${composeFile} 里读到主机端口 ${port}（粗略解析，请核对）。`);
      if (profiles.length > 0) evidence.push(`读到 profiles：${profiles.join('、')}。`);
    } catch { /* 读不到文件内容不影响形态判断 */ }
    return {
      path, kind: 'compose', evidence,
      suggestion: { label, composeDir: path, composeFile, ...(profiles.length > 0 ? { composeProfiles: profiles } : {}), ...(port ? { port } : {}) },
      candidates: [],
    };
  }

  /* ② 模型目录：有 GGUF */
  const ggufs = findGguf(path, depth);
  if (ggufs.length > 0) {
    const models = ggufs.filter((f) => !/mmproj/i.test(basename(f)));
    const mmprojs = ggufs.filter((f) => /mmproj/i.test(basename(f)));
    evidence.push(`找到 ${ggufs.length} 个 .gguf（模型 ${models.length} 个，mmproj ${mmprojs.length} 个）。`);
    const first = models[0] ?? ggufs[0];
    // mmproj 与模型同目录时自动配上，这正是多模态模型最容易漏的一步
    const sibling = mmprojs.find((p) => join(p, '..') === join(first, '..')) ?? mmprojs[0];
    if (sibling) evidence.push(`同目录有 mmproj，已为你选好：${basename(sibling)}。`);
    if (models.length > 1) evidence.push(`目录里有多个模型，默认取第一个，可在下一步改。`);
    return {
      path, kind: 'llama', evidence,
      suggestion: { label, model: first, ...(sibling ? { mmproj: sibling } : {}) },
      candidates: models.map((m) => ({ label: basename(m), value: m })),
    };
  }

  /* ③ 源代码项目：看标志文件 */
  const marker = CODE_MARKERS.find((m) => names.includes(m.file));
  if (marker) {
    evidence.push(`目录里有 ${marker.file}，看起来是 ${marker.label} 项目。`);
    evidence.push(`${marker.runtime} 的路径需要你自己填——不同机器上它未必在 PATH 里，猜错会起不来。`);
    return {
      path, kind: 'command', evidence,
      suggestion: { label, cwd: path },
      candidates: [],
    };
  }

  /* ④ 看不出来就说不出来，不猜 */
  const preview = names.slice(0, 6).join('、');
  evidence.push(`没找到可识别的标志文件（compose 文件 / *.gguf / requirements.txt / package.json 等）。`);
  if (preview) evidence.push(`目录里有：${preview}${names.length > 6 ? ' …' : ''}`);
  return { path, kind: 'unknown', evidence, suggestion: { label }, candidates: [] };
}
