import { describe, expect, it } from 'vitest';
import { ModelDownloader, parseRepoFiles } from '../model-downloader';

describe('HF 仓库文件列表解析', () => {
  it('只保留 gguf 并提取 LFS sha256', () => {
    const files = parseRepoFiles([
      { type: 'file', path: 'a.gguf', lfs: { oid: 'A'.repeat(64) } },
      { type: 'file', path: 'b.txt' },
      { type: 'directory', path: 'c' },
      { type: 'file', path: 'c.gguf' },
    ]);
    expect(files).toEqual([
      { path: 'a.gguf', sha256: 'a'.repeat(64) },
      { path: 'c.gguf', sha256: null },
    ]);
  });

  it('非数组输入返回空数组', () => {
    expect(parseRepoFiles(null)).toEqual([]);
    expect(parseRepoFiles({})).toEqual([]);
    expect(parseRepoFiles('nope')).toEqual([]);
  });

  it('非法摘要视为未知', () => {
    const files = parseRepoFiles([{ type: 'file', path: 'a.gguf', lfs: { oid: 'short' } }]);
    expect(files).toEqual([{ path: 'a.gguf', sha256: null }]);
  });

  it('缺少 path 的条目被跳过', () => {
    expect(parseRepoFiles([{ type: 'file', path: undefined }])).toEqual([]);
  });
});

describe('下载入口校验', () => {
  const downloader = new ModelDownloader();

  it('拒绝非 http/https 直链', async () => {
    const file = await downloader.downloadByUrl('file:///C:/m.gguf', 'D:\\models');
    expect(file.ok).toBe(false);
    expect(file.error).toContain('http/https');
  });

  it('无法解析的 URL 返回错误', async () => {
    const res = await downloader.downloadByUrl('not a url', 'D:\\models');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('URL 解析失败');
  });
});
