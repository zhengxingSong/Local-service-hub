import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateUserData } from '../user-data-migration';

const LEGACY = 'LLaMA 模型管理器';
const CURRENT = '服务中枢';

describe('userData 迁移', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  function setup(): { appDataDir: string; legacyDir: string; userDataDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'hub-migrate-'));
    roots.push(root);
    const appDataDir = join(root, 'AppData');
    const legacyDir = join(appDataDir, LEGACY);
    const userDataDir = join(appDataDir, CURRENT);
    mkdirSync(join(legacyDir, 'logs'), { recursive: true });
    writeFileSync(join(legacyDir, 'services.json'), '{"services":{"a":{}}}');
    writeFileSync(join(legacyDir, 'vram-cache.json'), '{"k":1}');
    writeFileSync(join(legacyDir, 'services.json.bak-20260905'), '{}');
    writeFileSync(join(legacyDir, 'logs', 'a.log'), 'log-line');
    // Chromium 自有缓存不应迁移
    writeFileSync(join(legacyDir, 'Preferences'), 'chromium');
    mkdirSync(join(legacyDir, 'GPUCache'), { recursive: true });
    writeFileSync(join(legacyDir, 'GPUCache', 'data_0'), 'cache');
    return { appDataDir, legacyDir, userDataDir };
  }

  it('迁移配置、显存缓存、日志与配置备份', () => {
    const { appDataDir, userDataDir } = setup();
    const result = migrateUserData({ userDataDir, appDataDir, legacyNames: [LEGACY] });
    expect(result.migrated).toBe(true);
    expect(readFileSync(join(userDataDir, 'services.json'), 'utf-8')).toContain('"a"');
    expect(existsSync(join(userDataDir, 'vram-cache.json'))).toBe(true);
    expect(readFileSync(join(userDataDir, 'logs', 'a.log'), 'utf-8')).toBe('log-line');
    expect(existsSync(join(userDataDir, 'services.json.bak-20260905'))).toBe(true);
  });

  it('不迁移 Chromium 缓存目录', () => {
    const { appDataDir, userDataDir } = setup();
    migrateUserData({ userDataDir, appDataDir, legacyNames: [LEGACY] });
    expect(existsSync(join(userDataDir, 'Preferences'))).toBe(false);
    expect(existsSync(join(userDataDir, 'GPUCache'))).toBe(false);
  });

  it('新目录已有配置时不迁移', () => {
    const { appDataDir, userDataDir } = setup();
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(join(userDataDir, 'services.json'), '{"services":{"new":{}}}');
    const result = migrateUserData({ userDataDir, appDataDir, legacyNames: [LEGACY] });
    expect(result.migrated).toBe(false);
    expect(readFileSync(join(userDataDir, 'services.json'), 'utf-8')).toContain('"new"');
  });

  it('没有旧目录时不动', () => {
    const root = mkdtempSync(join(tmpdir(), 'hub-migrate-'));
    roots.push(root);
    const result = migrateUserData({ userDataDir: join(root, CURRENT), appDataDir: join(root, 'AppData'), legacyNames: [LEGACY] });
    expect(result).toEqual({ migrated: false, from: null, copied: [] });
  });

  it('旧目录没有 services.json 时不迁移', () => {
    const root = mkdtempSync(join(tmpdir(), 'hub-migrate-'));
    roots.push(root);
    const appDataDir = join(root, 'AppData');
    mkdirSync(join(appDataDir, LEGACY), { recursive: true });
    const result = migrateUserData({ userDataDir: join(appDataDir, CURRENT), appDataDir, legacyNames: [LEGACY] });
    expect(result.migrated).toBe(false);
  });

  it('不会把新目录当成来源', () => {
    const { appDataDir, userDataDir } = setup();
    const result = migrateUserData({ userDataDir, appDataDir, legacyNames: [CURRENT, LEGACY] });
    expect(result.migrated).toBe(true);
    expect(result.from).toBe(join(appDataDir, LEGACY));
  });

  it('记录实际迁移的条目', () => {
    const { appDataDir, userDataDir } = setup();
    const result = migrateUserData({ userDataDir, appDataDir, legacyNames: [LEGACY] });
    expect(result.copied).toContain('services.json');
    expect(result.copied).toContain('logs/');
  });
});
