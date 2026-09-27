import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeLoadedConfig, type AppConfig, type ServiceConfig } from '../config';

function svc(over: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    label: 'S', role: '', model: 'm.gguf', mmproj: '', alias: 'a', port: 1,
    args: [], autostart: false, enabled: true, ...over,
  };
}

function baseWith(services: Record<string, ServiceConfig>): AppConfig {
  return { ...defaultConfig(), services };
}

describe('配置合并', () => {
  it('默认配置不含任何本机硬编码路径', () => {
    const cfg = defaultConfig();
    expect(cfg.services).toEqual({});
    expect(cfg.presets).toEqual({});
    expect(cfg.scanRoots).toEqual([]);
    expect(cfg.llamaServerPath).toBe('');
    expect(cfg.modelsRoot).toBe('');
    expect(cfg.autostartOnLogin).toBe(false);
  });

  it('磁盘上删除的服务不会复活', () => {
    const base = baseWith({ a: svc({ label: 'A' }), b: svc({ label: 'B' }) });
    const merged = mergeLoadedConfig({ services: { b: { label: 'B' } } }, base);
    expect(Object.keys(merged.services)).toEqual(['b']);
  });

  it('磁盘上删除的预设组不会复活', () => {
    const base: AppConfig = { ...defaultConfig(), presets: { g1: ['a'], g2: ['b'] } };
    const merged = mergeLoadedConfig({ presets: { g2: ['b'] } }, base);
    expect(Object.keys(merged.presets)).toEqual(['g2']);
  });

  it('为保留的服务补齐缺失字段', () => {
    const merged = mergeLoadedConfig({ services: { x: { model: 'm.gguf' } } }, defaultConfig());
    expect(merged.services.x).toMatchObject({
      model: 'm.gguf', args: [], port: 0, autostart: false, enabled: true, label: '', role: '',
    });
  });

  it('内置服务仍按字段补齐默认值', () => {
    const base = baseWith({ known: svc({ label: 'K', port: 1234, alias: 'ka' }) });
    const merged = mergeLoadedConfig({ services: { known: { model: 'other.gguf' } } }, base);
    expect(merged.services.known).toMatchObject({ label: 'K', port: 1234, alias: 'ka', model: 'other.gguf' });
  });

  it('services 段整体缺失时回退到内置默认集合', () => {
    const base = baseWith({ a: svc() });
    expect(Object.keys(mergeLoadedConfig({}, base).services)).toEqual(['a']);
    expect(Object.keys(mergeLoadedConfig({ maxRestarts: 3 }, base).services)).toEqual(['a']);
  });

  it('空 services 段表示确实没有服务', () => {
    const base = baseWith({ a: svc() });
    expect(mergeLoadedConfig({ services: {} }, base).services).toEqual({});
  });

  it('归一化手工编辑造成的类型错误', () => {
    const merged = mergeLoadedConfig(
      { services: { x: { args: 'not-an-array', port: '11435', autostart: 'yes', enabled: 0 } } },
      defaultConfig(),
    );
    expect(merged.services.x.args).toEqual([]);
    expect(merged.services.x.port).toBe(11435);
    expect(merged.services.x.autostart).toBe(true);
    expect(merged.services.x.enabled).toBe(false);
  });

  it('布尔字段接受常见写法，无法识别时回退默认值', () => {
    const merged = mergeLoadedConfig(
      {
        services: {
          a: { autostart: 'on', enabled: 'off' },
          b: { autostart: 'maybe', enabled: '' },
        },
      },
      defaultConfig(),
    );
    expect(merged.services.a).toMatchObject({ autostart: true, enabled: false });
    expect(merged.services.b).toMatchObject({ autostart: false, enabled: false });
  });

  it('端口为非数字时归零', () => {
    const merged = mergeLoadedConfig({ services: { x: { port: 'abc' } } }, defaultConfig());
    expect(merged.services.x.port).toBe(0);
  });

  it('保留顶层字段并与默认值合并', () => {
    const merged = mergeLoadedConfig(
      { llamaServerPath: 'D:\\x\\llama-server.exe', scanRoots: ['D:\\m'], maxRestarts: 2 },
      defaultConfig(),
    );
    expect(merged.llamaServerPath).toBe('D:\\x\\llama-server.exe');
    expect(merged.scanRoots).toEqual(['D:\\m']);
    expect(merged.maxRestarts).toBe(2);
    expect(merged.vramWarnThreshold).toBe(90);
  });

  it('exclusivePresets 非数组时回退为空数组', () => {
    expect(mergeLoadedConfig({ exclusivePresets: 'nope' }, defaultConfig()).exclusivePresets).toEqual([]);
  });
});
