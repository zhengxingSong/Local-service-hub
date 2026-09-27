import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanModels } from '../model-scanner';

describe('模型扫描', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  function mkRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hub-scan-'));
    roots.push(dir);
    return dir;
  }

  it('递归发现 gguf 并关联同目录 mmproj', async () => {
    const root = mkRoot();
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'b', 'm.gguf'), 'x');
    writeFileSync(join(root, 'a', 'b', 'mmproj-f16.gguf'), 'x');
    writeFileSync(join(root, 'a', 'b', 'readme.txt'), 'x');

    const found = await scanModels([root]);
    expect(found.map((f) => f.name)).toEqual(['m.gguf']);
    expect(found[0].siblingMmproj).toBe(join(root, 'a', 'b', 'mmproj-f16.gguf'));
    expect(found[0].sizeBytes).toBe(1);
  });

  it('mmproj 自身不作为模型条目', async () => {
    const root = mkRoot();
    writeFileSync(join(root, 'mmproj-f16.gguf'), 'x');
    expect(await scanModels([root])).toEqual([]);
  });

  it('按根集合缓存，force 时重新遍历', async () => {
    const root = mkRoot();
    writeFileSync(join(root, 'one.gguf'), 'x');
    expect((await scanModels([root])).length).toBe(1);
    writeFileSync(join(root, 'two.gguf'), 'x');
    expect((await scanModels([root])).length).toBe(1);
    expect((await scanModels([root], { force: true })).length).toBe(2);
  });

  it('缓存按根集合区分', async () => {
    const a = mkRoot();
    const b = mkRoot();
    writeFileSync(join(a, 'a.gguf'), 'x');
    writeFileSync(join(b, 'b.gguf'), 'x');
    expect((await scanModels([a])).map((m) => m.name)).toEqual(['a.gguf']);
    expect((await scanModels([b])).map((m) => m.name)).toEqual(['b.gguf']);
  });

  it('并发调用共享同一次遍历', async () => {
    const root = mkRoot();
    writeFileSync(join(root, 'one.gguf'), 'x');
    const [first, second] = await Promise.all([
      scanModels([root], { force: true }),
      scanModels([root], { force: true }),
    ]);
    expect(first).toBe(second);
  });

  it('不存在的根目录返回空而不是抛错', async () => {
    expect(await scanModels([join(tmpdir(), `hub-missing-${Date.now()}`)])).toEqual([]);
  });

  it('无根目录时返回空', async () => {
    expect(await scanModels([])).toEqual([]);
  });

  it('忽略空字符串根目录', async () => {
    expect(await scanModels(['', '   '.trim()])).toEqual([]);
  });

  it('结果按路径排序', async () => {
    const root = mkRoot();
    writeFileSync(join(root, 'z.gguf'), 'x');
    writeFileSync(join(root, 'a.gguf'), 'x');
    expect((await scanModels([root], { force: true })).map((m) => m.name)).toEqual(['a.gguf', 'z.gguf']);
  });
});
