import { describe, expect, it, vi } from 'vitest';
import type { ServiceConfig } from '../config';
import {
  canAdoptByHealthCheck,
  defaultAlias,
  matchesOpenAiModelList,
  resolveAlias,
  resolveHealthCheck,
  runHealthCheck,
  serviceKind,
  type HealthProbes,
} from '../service-model';

function cfg(over: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    label: 'S', role: '', model: 'D:\\m\\qwen3-8b-Q4_K_M.gguf', mmproj: '', alias: '',
    port: 8080, args: [], autostart: false, enabled: true, ...over,
  };
}

function probes(over: Partial<HealthProbes> = {}): HealthProbes {
  return {
    tcp: vi.fn(async () => true),
    http: vi.fn(async () => ({ status: 200, body: 'ok' })),
    openaiModels: vi.fn(async () => true),
    ...over,
  };
}

describe('服务形态推断', () => {
  it('显式 kind 优先于字段推断', () => {
    expect(serviceKind(cfg({ kind: 'compose', command: 'py.exe' }))).toBe('compose');
  });
  it('有 composeDir 推断为 compose', () => {
    expect(serviceKind(cfg({ composeDir: 'E:\\weknora' }))).toBe('compose');
  });
  it('有 command 推断为 command', () => {
    expect(serviceKind(cfg({ command: 'py.exe', model: '' }))).toBe('command');
  });
  it('都没有时是 llama', () => {
    expect(serviceKind(cfg())).toBe('llama');
  });
});

describe('别名解析', () => {
  it('无 alias 时由模型文件名推导', () => {
    expect(resolveAlias(cfg())).toBe('qwen3-8b-Q4_K_M');
  });
  it('显式 alias 优先', () => {
    expect(resolveAlias(cfg({ alias: 'custom' }))).toBe('custom');
  });
  it('空模型名回退到 model', () => {
    expect(defaultAlias('')).toBe('model');
  });
});

describe('就绪判定解析', () => {
  it('llama 形态默认用模型列表校验 alias', () => {
    expect(resolveHealthCheck(cfg())).toMatchObject({
      type: 'openai-models', path: '/v1/models', expectAlias: 'qwen3-8b-Q4_K_M',
    });
  });
  it('命令服务默认用端口探活', () => {
    expect(resolveHealthCheck(cfg({ command: 'py.exe', model: '' })).type).toBe('tcp');
  });
  it('compose 服务默认用端口探活', () => {
    expect(resolveHealthCheck(cfg({ composeDir: 'E:\\x', model: '' })).type).toBe('tcp');
  });
  it('显式 http 判定填默认路径并展开占位符', () => {
    const check = resolveHealthCheck(cfg({ alias: 'myalias', healthCheck: { type: 'http', expectBody: '{{alias}}:{{port}}' } }));
    expect(check).toMatchObject({ type: 'http', path: '/', expectBody: 'myalias:8080' });
  });
  it('显式 none 不检查', () => {
    expect(resolveHealthCheck(cfg({ healthCheck: { type: 'none' } })).type).toBe('none');
  });
  it('显式 openai-models 的 expectAlias 支持占位符', () => {
    const check = resolveHealthCheck(cfg({ healthCheck: { type: 'openai-models', path: '/v1/models', expectAlias: '{{alias}}' } }));
    expect(check.expectAlias).toBe('qwen3-8b-Q4_K_M');
  });
  it('显式 openai-models 未给 expectAlias 时回退到 alias', () => {
    expect(resolveHealthCheck(cfg({ alias: 'x', healthCheck: { type: 'openai-models' } })).expectAlias).toBe('x');
  });
});

describe('就绪判定执行', () => {
  it('none 视为已就绪且不探活', async () => {
    const p = probes();
    expect(await runHealthCheck(cfg({ healthCheck: { type: 'none' } }), p)).toEqual({ listening: true, healthy: true });
    expect(p.tcp).not.toHaveBeenCalled();
  });

  it('tcp 以端口为准', async () => {
    expect(await runHealthCheck(cfg({ command: 'x' }), probes({ tcp: async () => false })))
      .toEqual({ listening: false, healthy: false });
  });

  it('http 校验状态码与响应体', async () => {
    const ok = await runHealthCheck(
      cfg({ healthCheck: { type: 'http', path: '/healthz', expectStatus: 204, expectBody: 'fine' } }),
      probes({ http: async () => ({ status: 204, body: 'fine' }) }),
    );
    expect(ok).toEqual({ listening: true, healthy: true });

    const wrongBody = await runHealthCheck(
      cfg({ healthCheck: { type: 'http', path: '/healthz', expectBody: 'fine' } }),
      probes({ http: async () => ({ status: 200, body: 'broken' }) }),
    );
    expect(wrongBody.healthy).toBe(false);

    const wrongStatus = await runHealthCheck(
      cfg({ healthCheck: { type: 'http', path: '/healthz', expectStatus: 200 } }),
      probes({ http: async () => ({ status: 503, body: '' }) }),
    );
    expect(wrongStatus).toEqual({ listening: true, healthy: false });
  });

  it('http 连接失败视为未监听', async () => {
    expect(await runHealthCheck(cfg({ healthCheck: { type: 'http' } }), probes({ http: async () => ({ status: 0, body: '' }) })))
      .toEqual({ listening: false, healthy: false });
  });

  it('openai-models 先探端口再校验模型', async () => {
    expect(await runHealthCheck(cfg(), probes({ tcp: async () => false }))).toEqual({ listening: false, healthy: false });
    const p = probes();
    expect(await runHealthCheck(cfg(), p)).toEqual({ listening: true, healthy: true });
    expect(p.openaiModels).toHaveBeenCalledWith(8080, '/v1/models', 'qwen3-8b-Q4_K_M');
  });

  it('端口为 0 时不探活', async () => {
    const p = probes();
    expect(await runHealthCheck(cfg({ port: 0 }), p)).toEqual({ listening: false, healthy: false });
    expect(p.tcp).not.toHaveBeenCalled();
  });

  it('只有能识别实例身份的判定允许接管', () => {
    expect(canAdoptByHealthCheck({ type: 'openai-models', path: '/v1/models', expectAlias: 'a' })).toBe(true);
    expect(canAdoptByHealthCheck({ type: 'http', path: '/', expectAlias: '' })).toBe(true);
    expect(canAdoptByHealthCheck({ type: 'tcp', path: '', expectAlias: '' })).toBe(false);
    expect(canAdoptByHealthCheck({ type: 'none', path: '', expectAlias: '' })).toBe(false);
  });
});

describe('OpenAI 模型列表解析', () => {
  it('命中 id', () => {
    expect(matchesOpenAiModelList('{"data":[{"id":"bge-m3"}]}', 'bge-m3')).toBe(true);
  });
  it('命中 aliases', () => {
    expect(matchesOpenAiModelList('{"data":[{"id":"x","aliases":["bge-m3"]}]}', 'bge-m3')).toBe(true);
  });
  it('不匹配时返回 false', () => {
    expect(matchesOpenAiModelList('{"data":[{"id":"other"}]}', 'bge-m3')).toBe(false);
  });
  it('alias 是其他 id 的子串不算命中', () => {
    expect(matchesOpenAiModelList('{"data":[{"id":"bge-m3-large"}]}', 'bge-m3')).toBe(false);
  });
  it('非法 JSON 返回 false', () => {
    expect(matchesOpenAiModelList('<html>', 'x')).toBe(false);
  });
  it('缺少 data 字段返回 false', () => {
    expect(matchesOpenAiModelList('{}', 'x')).toBe(false);
  });
});
