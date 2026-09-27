import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationResult {
  migrated: boolean;
  /** 实际迁移来源目录；未迁移时为 null */
  from: string | null;
  /** 已迁移的条目名 */
  copied: string[];
}

/**
 * 需要迁移的内容：配置、显存缓存、日志与配置备份。
 * 不迁移 Chromium 自有的缓存目录（Cache/GPUCache/Code Cache 等），它们会在新目录重建。
 */
const MIGRATED_FILES = ['services.json', 'vram-cache.json'];
const MIGRATED_DIRS = ['logs'];
const BACKUP_PATTERN = /^services\.json\.bak-/;

/**
 * 首次以新名称启动时，把旧 userData 目录的配置与日志搬到新目录。
 * 新目录已有 services.json 时不做任何事，因此可安全地在每次启动时调用。
 */
export function migrateUserData(options: {
  userDataDir: string;
  appDataDir: string;
  legacyNames: string[];
}): MigrationResult {
  const { userDataDir, appDataDir, legacyNames } = options;
  const sentinel = join(userDataDir, 'services.json');
  if (existsSync(sentinel)) return { migrated: false, from: null, copied: [] };

  const legacyDir = legacyNames
    .map((name) => join(appDataDir, name))
    .find((dir) => dir !== userDataDir && existsSync(join(dir, 'services.json')));
  if (!legacyDir) return { migrated: false, from: null, copied: [] };

  const copied: string[] = [];
  try {
    mkdirSync(userDataDir, { recursive: true });
  } catch {
    return { migrated: false, from: null, copied: [] };
  }

  for (const name of MIGRATED_FILES) {
    if (copyInto(join(legacyDir, name), join(userDataDir, name))) copied.push(name);
  }
  for (const name of MIGRATED_DIRS) {
    if (copyInto(join(legacyDir, name), join(userDataDir, name), true)) copied.push(`${name}/`);
  }
  try {
    for (const entry of readdirSync(legacyDir)) {
      if (!BACKUP_PATTERN.test(entry)) continue;
      if (copyInto(join(legacyDir, entry), join(userDataDir, entry))) copied.push(entry);
    }
  } catch { /* 旧目录不可读时只迁移已列出的条目 */ }

  return { migrated: true, from: legacyDir, copied };
}

function copyInto(from: string, to: string, recursive = false): boolean {
  if (!existsSync(from) || existsSync(to)) return false;
  try {
    cpSync(from, to, { recursive });
    return true;
  } catch {
    return false;
  }
}
