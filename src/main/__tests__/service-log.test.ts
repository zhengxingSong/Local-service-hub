import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendServiceLog, clearServiceLog, readFileTailBytes, readServiceLogTail, serviceLogFile } from '../service-log';

describe('服务日志', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hub-log-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('追加内容后可按字符读取尾部', () => {
    appendServiceLog(dir, 'svc', 'hello');
    appendServiceLog(dir, 'svc', ' world');
    expect(readFileSync(serviceLogFile(dir, 'svc'), 'utf-8')).toBe('hello world');
    expect(readServiceLogTail(dir, 'svc', 5)).toBe('world');
  });

  it('超过上限时轮转为 .log.1 而不是停止记录', () => {
    const max = 1024;
    appendServiceLog(dir, 'svc', 'a'.repeat(700), max);
    appendServiceLog(dir, 'svc', 'b'.repeat(700), max);
    const file = serviceLogFile(dir, 'svc');
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(`${file}.1`).size).toBe(700);
    expect(readFileSync(file, 'utf-8')).toBe('b'.repeat(700));
    // 轮转后仍继续写入
    appendServiceLog(dir, 'svc', 'c', max);
    expect(readFileSync(file, 'utf-8')).toBe(`${'b'.repeat(700)}c`);
  });

  it('第二次轮转覆盖旧备份，磁盘占用有界', () => {
    const max = 512;
    for (let i = 0; i < 4; i += 1) appendServiceLog(dir, 'svc', 'x'.repeat(400), max);
    const file = serviceLogFile(dir, 'svc');
    expect(statSync(`${file}.1`).size).toBeLessThanOrEqual(max);
    expect(statSync(file).size).toBeLessThanOrEqual(max);
  });

  it('尾部读取不会切出半个多字节字符', () => {
    appendServiceLog(dir, 'svc', '开头中文内容');
    const tail = readFileTailBytes(serviceLogFile(dir, 'svc'), 7);
    expect(tail).not.toContain('\uFFFD');
    expect(tail).toBe('内容');
  });

  it('文件不存在时返回空字符串', () => {
    expect(readServiceLogTail(dir, 'missing')).toBe('');
  });

  it('清空日志', () => {
    appendServiceLog(dir, 'svc', 'data');
    clearServiceLog(dir, 'svc');
    expect(readFileSync(serviceLogFile(dir, 'svc'), 'utf-8')).toBe('');
  });

  it('空文本不产生写入', () => {
    appendServiceLog(dir, 'svc', '');
    expect(existsSync(serviceLogFile(dir, 'svc'))).toBe(false);
  });

  it('读取超大文件时只读尾部', () => {
    const file = serviceLogFile(dir, 'big');
    writeFileSync(file, 'head'.repeat(100_000)); // 400KB
    expect(readServiceLogTail(dir, 'big', 4)).toBe('head');
  });
});
