import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectPath } from '../probe';

/** 造一棵临时目录树：key 是相对路径，值是文件内容（'' 表示空文件）。 */
function tree(spec: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'service-hub-probe-'));
  for (const [rel, content] of Object.entries(spec)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('探测：给一个目录判断它是什么形态', () => {
  it('有 compose 文件就判为 docker 应用，并读出端口与 profiles（标注为粗略解析）', () => {
    const dir = tree({
      'docker-compose.yml': [
        'services:',
        '  app:',
        '    image: weknora:latest',
        '    ports:',
        '      - "18080:8080"',
        '    profiles:',
        '      - neo4j',
      ].join('\n'),
    });
    const r = inspectPath(dir);
    expect(r.kind).toBe('compose');
    expect(r.suggestion.composeFile).toBe('docker-compose.yml');
    expect(r.suggestion.port).toBe(18080);
    expect(r.suggestion.composeProfiles).toEqual(['neo4j']);
    expect(r.evidence.join(' ')).toContain('粗略解析');
  });

  it('compose.yaml 也能识别（不只是 docker-compose.yml）', () => {
    const dir = tree({ 'compose.yaml': 'services:\n  a:\n    image: x\n' });
    expect(inspectPath(dir).kind).toBe('compose');
  });

  it('有 gguf 就判为模型服务，并自动配上同目录的 mmproj', () => {
    const dir = tree({
      'Qwen2.5-VL-7B/qwen2.5-vl-7b-Q4_K_M.gguf': '',
      'Qwen2.5-VL-7B/mmproj-f16.gguf': '',
    });
    const r = inspectPath(dir);
    expect(r.kind).toBe('llama');
    expect(r.suggestion.model).toContain('qwen2.5-vl-7b-Q4_K_M.gguf');
    expect(r.suggestion.mmproj).toContain('mmproj-f16.gguf');
    expect(r.evidence.join(' ')).toContain('mmproj');
  });

  it('多个模型时默认取第一个并列出候选，不假装只有一个', () => {
    const dir = tree({
      'a.gguf': '', 'b.gguf': '', 'c.gguf': '',
    });
    const r = inspectPath(dir);
    expect(r.kind).toBe('llama');
    expect(r.candidates).toHaveLength(3);
    expect(r.evidence.join(' ')).toContain('多个模型');
  });

  it('有 requirements.txt 判为源代码项目，并且**不猜**可执行文件路径', () => {
    const dir = tree({ 'requirements.txt': 'flask\n', 'main.py': 'print(1)\n' });
    const r = inspectPath(dir);
    expect(r.kind).toBe('command');
    expect(r.suggestion.cwd).toBe(dir);
    expect(r.suggestion.command).toBeUndefined();
    expect(r.evidence.join(' ')).toContain('需要你自己填');
  });

  it('package.json 判为 Node 项目', () => {
    const dir = tree({ 'package.json': '{}' });
    const r = inspectPath(dir);
    expect(r.kind).toBe('command');
    expect(r.evidence.join(' ')).toContain('Node.js');
  });

  it('认不出来就说认不出来，不猜形态', () => {
    const dir = tree({ 'notes.txt': 'hello', 'photo.png': '' });
    const r = inspectPath(dir);
    expect(r.kind).toBe('unknown');
    expect(r.evidence.join(' ')).toContain('没找到可识别的标志文件');
    expect(r.evidence.join(' ')).toContain('notes.txt');
  });

  it('空路径与不存在的路径都给出明确说明，而不是抛错', () => {
    expect(inspectPath('').kind).toBe('missing');
    const r = inspectPath(join(tmpdir(), 'definitely-not-here-9f3a'));
    expect(r.kind).toBe('missing');
    expect(r.evidence.join(' ')).toContain('不存在');
  });

  it('给的是文件而不是目录时，提示去「启动 → 模型」里直接选', () => {
    const dir = tree({ 'a.gguf': '' });
    const r = inspectPath(join(dir, 'a.gguf'));
    expect(r.kind).toBe('missing');
    expect(r.evidence.join(' ')).toContain('不是目录');
  });

  it('GGUF 只在深于两层时不被误判为模型目录（避免在大盘上乱跑）', () => {
    const dir = tree({ 'a/b/c/d.gguf': '', 'requirements.txt': 'x' });
    const r = inspectPath(dir);   // 深度 2：a/b 是两层，c/d.gguf 在第三层
    expect(r.kind).toBe('command');
  });
});
