import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigStore,
  SNAPSHOT_KEEP,
  createSnapshotFor,
  defaultConfig,
  listSnapshotsFor,
  restoreSnapshotFor,
} from '../config';

/** 每个用例一个独立目录：快照是磁盘行为，不能共享临时目录。 */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'service-hub-snap-'));
}

function snapshotFiles(file: string): string[] {
  const base = file.split(/[\\/]/).pop() as string;
  return readdirSync(join(file, '..')).filter((n) => n.startsWith(`${base}.bak-`));
}

describe('配置快照', () => {
  it('保存前会给上一份配置留快照；首次保存没有上一份，因此不产生快照', () => {
    const dir = tempDir();
    const file = join(dir, 'services.json');
    const store = new ConfigStore(file);

    store.save(defaultConfig());
    expect(snapshotFiles(file)).toHaveLength(0);

    store.save({ ...defaultConfig(), maxRestarts: 7 });
    const snaps = listSnapshotsFor(file);
    expect(snaps).toHaveLength(1);
    // 快照存的是「保存前」的那一份内容
    const saved = JSON.parse(readFileSync(join(dir, snaps[0].name), 'utf-8')) as { maxRestarts: number };
    expect(saved.maxRestarts).toBe(5);
    expect(snaps[0].reason).toBe('保存前');
  });

  it('内容没变时不产生新快照（连续保存不刷屏）', () => {
    const dir = tempDir();
    const file = join(dir, 'services.json');
    const store = new ConfigStore(file);
    store.save(defaultConfig());
    store.save({ ...defaultConfig(), maxRestarts: 7 });
    store.save({ ...defaultConfig(), maxRestarts: 7 });
    store.save({ ...defaultConfig(), maxRestarts: 7 });
    expect(listSnapshotsFor(file)).toHaveLength(1);
  });

  it('最新的一份排在最前', () => {
    const dir = tempDir();
    const file = join(dir, 'services.json');
    writeFileSync(file, JSON.stringify({ v: 1 }));
    for (const v of [2, 3, 4]) {
      createSnapshotFor(file, '保存前');
      writeFileSync(file, JSON.stringify({ v }));
    }
    const snaps = listSnapshotsFor(file);
    expect(snaps.length).toBe(3);
    expect(snaps[0].createdAt >= snaps[snaps.length - 1].createdAt).toBe(true);
  });

  it(`只保留最近 ${SNAPSHOT_KEEP} 份`, () => {
    const dir = tempDir();
    const file = join(dir, 'services.json');
    writeFileSync(file, JSON.stringify({ v: 0 }));
    for (let i = 1; i <= SNAPSHOT_KEEP + 3; i += 1) {
      createSnapshotFor(file, '保存前');
      writeFileSync(file, JSON.stringify({ v: i }));
    }
    expect(snapshotFiles(file)).toHaveLength(SNAPSHOT_KEEP);
  });

  it('恢复会把内容换回快照那一份，并在恢复前再存一份（可逆）', () => {
    const dir = tempDir();
    const file = join(dir, 'services.json');
    const store = new ConfigStore(file);
    store.save({ ...defaultConfig(), maxRestarts: 1 });
    const first = store.listSnapshots();
    expect(first).toHaveLength(0); // 首次没有上一份

    store.save({ ...defaultConfig(), maxRestarts: 2 });
    const afterSecond = store.listSnapshots();
    expect(afterSecond).toHaveLength(1);

    // 恢复到「maxRestarts = 1」那一份
    expect(store.restoreSnapshot(afterSecond[0].name)).toBe(true);
    const restored = JSON.parse(readFileSync(file, 'utf-8')) as { maxRestarts: number };
    expect(restored.maxRestarts).toBe(1);

    // 恢复前又存了一份「maxRestarts = 2」，所以现在有两份，且最新的是恢复前的那份
    const afterRestore = store.listSnapshots();
    expect(afterRestore.length).toBe(2);
    expect(afterRestore[0].reason).toBe('恢复前');
  });

  it('拒绝目录穿越：只接受本配置文件自己的裸文件名', () => {
    const dir = tempDir();
    const file = join(dir, 'services.json');
    const store = new ConfigStore(file);
    store.save(defaultConfig());
    store.save({ ...defaultConfig(), maxRestarts: 3 });

    expect(restoreSnapshotFor(file, '')).toBe(false);
    expect(restoreSnapshotFor(file, '..\\services.json')).toBe(false);
    expect(restoreSnapshotFor(file, 'services.json.bak-x/../../evil.json')).toBe(false);
    expect(restoreSnapshotFor(file, 'other.json.bak-20260101000000000')).toBe(false);
    // 合法名字但文件不存在
    expect(restoreSnapshotFor(file, 'services.json.bak-20260101000000000')).toBe(false);
  });

  it('没有清单记录的旧快照也能列出，原因显示为旧版迁移', () => {
    const dir = tempDir();
    const file = join(dir, 'services.json');
    writeFileSync(file, '{}');
    writeFileSync(`${file}.bak-20260101000000`, '{"legacy":true}');
    const snaps = listSnapshotsFor(file);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].reason).toBe('旧版迁移');
    expect(existsSync(join(dir, snaps[0].name))).toBe(true);
  });

  it('配置文件不存在时不建快照（不产生空快照）', () => {
    const dir = tempDir();
    const file = join(dir, 'services.json');
    expect(createSnapshotFor(file, '保存前')).toBeNull();
    expect(listSnapshotsFor(file)).toHaveLength(0);
  });
});
