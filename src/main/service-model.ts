import { basename } from 'node:path';
import type { HealthCheck, ServiceConfig, ServiceKind } from './config';

export interface ResolvedHealthCheck {
  type: HealthCheck['type'];
  path: string;
  expectStatus?: number;
  expectBody?: string;
  expectAlias: string;
}

export interface HealthResult {
  /** 端口可连接 */
  listening: boolean;
  /** 按该服务的就绪判定确认可用 */
  healthy: boolean;
}

export interface HealthProbes {
  tcp: (port: number) => Promise<boolean>;
  http: (port: number, path: string) => Promise<{ status: number; body: string }>;
  openaiModels: (port: number, path: string, alias: string) => Promise<boolean>;
}

function assertNever(value: never): never {
  throw new Error(`未处理的分支: ${JSON.stringify(value)}`);
}

/** 服务的启动形态：优先显式 kind，否则按已有字段推断（兼容旧配置）。 */
export function serviceKind(config: ServiceConfig): ServiceKind {
  if (config.kind) return config.kind;
  if (config.composeDir) return 'compose';
  if (config.command) return 'command';
  return 'llama';
}

export function defaultAlias(model: string): string {
  return basename(model ?? '').replace(/\.gguf$/i, '') || 'model';
}

/** 服务对外声明的模型名：显式 alias 优先，否则由模型文件名推导。 */
export function resolveAlias(config: ServiceConfig): string {
  return config.alias || defaultAlias(config.model);
}

/**
 * 解析服务的就绪判定。
 * 未显式配置时：llama 形态用 OpenAI 兼容的 /v1/models 校验 alias（llama.cpp、Ollama、vLLM 等通用），
 * 其余形态用 TCP 探活。
 */
export function resolveHealthCheck(config: ServiceConfig): ResolvedHealthCheck {
  const explicit = config.healthCheck;
  if (explicit) {
    switch (explicit.type) {
      case 'none':
        return { type: 'none', path: '', expectAlias: '' };
      case 'tcp':
        return { type: 'tcp', path: '', expectAlias: '' };
      case 'http':
        return {
          type: 'http',
          path: explicit.path || '/',
          expectStatus: explicit.expectStatus,
          expectBody: expandPlaceholders(explicit.expectBody, config),
          expectAlias: '',
        };
      case 'openai-models':
        return {
          type: 'openai-models',
          path: explicit.path || '/v1/models',
          expectAlias: expandPlaceholders(explicit.expectAlias, config) || resolveAlias(config),
        };
      default:
        return assertNever(explicit);
    }
  }
  if (serviceKind(config) === 'llama') {
    return { type: 'openai-models', path: '/v1/models', expectAlias: resolveAlias(config) };
  }
  return { type: 'tcp', path: '', expectAlias: '' };
}

/** 端口已被占用时能否接管：只有能识别实例身份的判定才安全，纯 TCP 无法区分是不是同一实例。 */
export function canAdoptByHealthCheck(check: ResolvedHealthCheck): boolean {
  return check.type === 'openai-models' || check.type === 'http';
}

export async function runHealthCheck(config: ServiceConfig, probes: HealthProbes): Promise<HealthResult> {
  const port = Number(config.port) || 0;
  if (port <= 0) return { listening: false, healthy: false };
  const check = resolveHealthCheck(config);
  switch (check.type) {
    case 'none':
      return { listening: true, healthy: true };
    case 'tcp': {
      const listening = await probes.tcp(port);
      return { listening, healthy: listening };
    }
    case 'http': {
      const res = await probes.http(port, check.path);
      if (res.status <= 0) return { listening: false, healthy: false };
      const statusOk = check.expectStatus === undefined
        ? res.status >= 200 && res.status < 400
        : res.status === check.expectStatus;
      const bodyOk = check.expectBody === undefined || res.body.includes(check.expectBody);
      return { listening: true, healthy: statusOk && bodyOk };
    }
    case 'openai-models': {
      const listening = await probes.tcp(port);
      if (!listening) return { listening: false, healthy: false };
      const healthy = await probes.openaiModels(port, check.path, check.expectAlias);
      return { listening, healthy };
    }
    default:
      return assertNever(check.type);
  }
}

/** 展开 {{alias}} / {{model}} / {{port}} 占位符。 */
function expandPlaceholders(text: string | undefined, config: ServiceConfig): string | undefined {
  if (text === undefined) return undefined;
  return text
    .replaceAll('{{alias}}', resolveAlias(config))
    .replaceAll('{{model}}', config.model ?? '')
    .replaceAll('{{port}}', String(config.port ?? ''));
}

/**
 * 判断 OpenAI 兼容的 /v1/models 响应里是否含指定 alias。
 * llama.cpp、Ollama、vLLM、LM Studio 都返回 { data: [{ id, aliases? }] } 结构。
 */
export function matchesOpenAiModelList(body: string, alias: string): boolean {
  try {
    const parsed = JSON.parse(body) as { data?: { id?: string; aliases?: string[] }[] };
    return (parsed.data ?? []).some((m) => m.id === alias || (m.aliases ?? []).includes(alias));
  } catch {
    return false;
  }
}
