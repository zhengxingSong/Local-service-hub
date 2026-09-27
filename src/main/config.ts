import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, watchFile, unwatchFile, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ServiceConfig {
  label: string;
  role: string;
  model: string;
  mmproj: string;
  alias: string;
  port: number;
  args: string[];
  autostart: boolean;
  enabled: boolean;
  /** 通用命令模式：非空时直接执行该命令（无视 llama 模板），args 作为其参数 */
  command?: string;
  /** 通用命令模式：工作目录 */
  cwd?: string;
  /** 通用命令模式：附加环境变量 */
  env?: Record<string, string>;
  /** 预留：远程主机地址，默认本机；当前仅存储不生效 */
  host?: string;
  /** Compose 模式：非空时通过 docker compose 管理；值为 compose 文件所在目录 */
  composeDir?: string;
  /** Compose 模式：可选 --profile 参数 */
  composeProfiles?: string[];
  /** Compose 模式：可选 compose 文件路径（默认 composeDir 下自动发现） */
  composeFile?: string;
}

export interface AppConfig {
  llamaServerPath: string;
  scanRoots: string[];
  maxRestarts: number;
  autostartOnLogin: boolean;
  vramWarnThreshold: number;
  services: Record<string, ServiceConfig>;
  presets: Record<string, string[]>;
  /** 独占运行预设组名列表：启动其中一组时提示停止其他运行中的组 */
  exclusivePresets: string[];
}

const MODELS_ROOT = 'D:\\LLM Model\\llama.cpp\\models';
const OV_PYTHON = 'D:\\Python\\Python312\\python.exe';
const OV_RUNNER = 'D:\\deepseek\\ov-data\\run-server.py';
const OV_CONF = 'D:\\deepseek\\ov-data\\ov.conf';

function defaultServices(): Record<string, ServiceConfig> {
  return {
    vlm: {
      label: 'VLM · Qwen2.5-VL-7B',
      role: 'vlm',
      model: `${MODELS_ROOT}\\Qwen2.5-VL-7B\\qwen2.5-vl-7b-instruct-Q4_K_M.gguf`,
      mmproj: `${MODELS_ROOT}\\Qwen2.5-VL-7B\\mmproj-f16.gguf`,
      alias: 'qwen2.5-vl-7b',
      port: 11435,
      args: ['--ctx-size', '8192', '--parallel', '1', '--flash-attn', 'on', '-ngl', '99', '-b', '512', '--threads', '6', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--jinja'],
      autostart: false,
      enabled: true,
    },
    embedding: {
      label: 'Embedding · bge-m3',
      role: 'embedding',
      model: `${MODELS_ROOT}\\bge-m3\\bge-m3-Q8_0.gguf`,
      mmproj: '',
      alias: 'bge-m3',
      port: 11436,
      args: ['--embeddings', '--ctx-size', '8192', '--threads', '6', '-ngl', '99'],
      autostart: false,
      enabled: true,
    },
    intent: {
      label: 'Intent · ov_intent_analysis_sft',
      role: 'intent',
      model: `${MODELS_ROOT}\\ov_intent_analysis_sft\\ov_intent_analysis_sft-Q8_0.gguf`,
      mmproj: '',
      alias: 'ov_intent_analysis_sft',
      port: 11437,
      args: ['--ctx-size', '8192', '--parallel', '1', '-ngl', '99', '-b', '512', '--threads', '6', '--jinja', '--reasoning', 'off'],
      autostart: false,
      enabled: true,
    },
    'chat-27b': {
      label: 'Chat · Qwen3.8-27B',
      role: 'chat',
      model: `${MODELS_ROOT}\\Qwen3.8-27B\\Qwen3.8-27B-UD-Q4_K_XL.gguf`,
      mmproj: '',
      alias: 'qwen3.8-27b',
      port: 8080,
      args: ['--ctx-size', '98304', '--parallel', '1', '--flash-attn', 'on', '-ngl', '99', '-ub', '64', '-b', '512', '--load-mode', 'none', '--threads', '6', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--spec-type', 'draft-mtp', '--spec-draft-n-max', '2', '--spec-draft-p-min', '0.4', '--jinja', '--tools', 'all', '--metrics'],
      autostart: false,
      enabled: true,
    },
    reranker: {
      label: 'Rerank · Qwen3-Reranker-0.6B',
      role: 'rerank',
      model: `${MODELS_ROOT}\\Qwen3-Reranker-0.6B\\Qwen3-Reranker-0.6B-Q4_K_M.gguf`,
      mmproj: '',
      alias: 'qwen3-reranker-0.6b',
      port: 11438,
      args: ['--reranking', '--pooling', 'rank', '--embedding', '--ctx-size', '8192', '-ngl', '99'],
      autostart: false,
      enabled: true,
    },
    'ov-server': {
      label: 'OpenViking 服务',
      role: 'ov',
      model: '',
      mmproj: '',
      alias: '',
      port: 1933,
      args: [OV_RUNNER, '--config', OV_CONF],
      autostart: false,
      enabled: true,
      command: OV_PYTHON,
      cwd: 'D:\\deepseek\\ov-data',
      env: { PYTHONUNBUFFERED: '1' },
    },
  };
}

function defaultPresets(): Record<string, string[]> {
  return {
    'OpenViking 组': ['vlm', 'embedding', 'intent', 'ov-server'],
    聊天组: ['chat-27b'],
  };
}

export function defaultConfig(): AppConfig {
  return {
    llamaServerPath: 'D:\\LLM Model\\llama.cpp\\runtime\\llama-server.exe',
    scanRoots: ['D:\\LLM Model'],
    maxRestarts: 5,
    autostartOnLogin: true,
    vramWarnThreshold: 90,
    services: defaultServices(),
    presets: defaultPresets(),
    exclusivePresets: [],
  };
}

export class ConfigStore {
  private file: string;
  /** 应用自身 save 触发 watch 时置位，避免自触发外部变更回调 */
  private suppressNext = false;

  constructor() {
    this.file = join(app.getPath('userData'), 'services.json');
  }

  load(): AppConfig {
    if (!existsSync(this.file)) {
      const cfg = defaultConfig();
      this.save(cfg);
      return cfg;
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf-8'));
      const base = defaultConfig();
      return {
        ...base,
        ...raw,
        services: { ...base.services, ...(raw.services ?? {}) },
        presets: { ...base.presets, ...(raw.presets ?? {}) },
        exclusivePresets: Array.isArray(raw.exclusivePresets) ? raw.exclusivePresets : [],
      };
    } catch {
      return defaultConfig();
    }
  }

  save(config: AppConfig): void {
    this.suppressNext = true;
    mkdirSync(join(app.getPath('userData')), { recursive: true });
    writeFileSync(this.file, JSON.stringify(config, null, 2));
  }

  /** 重新从磁盘读取（外部修改后热加载用） */
  reload(): AppConfig {
    return this.load();
  }

  /**
   * 监听配置文件的外部修改（应用自身 save 会被 suppress 抑制）。
   * 返回停止监听的函数。
   */
  watch(onExternalChange: () => void): () => void {
    watchFile(this.file, { interval: 1500 }, () => {
      if (this.suppressNext) {
        this.suppressNext = false;
        return;
      }
      onExternalChange();
    });
    return () => {
      unwatchFile(this.file);
    };
  }
}