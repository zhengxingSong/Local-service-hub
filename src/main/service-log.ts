import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 单个服务日志的软上限：超过即轮转，而不是停止记录。 */
export const MAX_LOG_BYTES = 5 * 1024 * 1024;
/** 单次读取返回的字节上限，避免渲染层一次请求读入过大的日志。 */
const MAX_READ_BYTES = 512 * 1024;
/** 取尾读取的字节下限，保证短请求也能拿到完整最后一行。 */
const MIN_READ_BYTES = 1024;

export function serviceLogFile(logDir: string, id: string): string {
  return join(logDir, `${id}.log`);
}

/**
 * 追加服务日志。写入会超过 maxBytes 时先把当前文件轮转为 `<id>.log.1`（只保留一份历史），
 * 轮转失败则退化为保留文件尾部再续写，保证日志不静默中断。
 */
export function appendServiceLog(logDir: string, id: string, text: string, maxBytes = MAX_LOG_BYTES): void {
  if (!text) return;
  try {
    mkdirSync(logDir, { recursive: true });
    const file = serviceLogFile(logDir, id);
    const size = existsSync(file) ? statSync(file).size : 0;
    if (size + Buffer.byteLength(text) > maxBytes) rotateLog(file, maxBytes);
    appendFileSync(file, text);
  } catch { /* 日志失败不得影响服务管理 */ }
}

function rotateLog(file: string, maxBytes: number): void {
  const backup = `${file}.1`;
  try {
    rmSync(backup, { force: true });
    renameSync(file, backup);
    return;
  } catch { /* 备份被占用时退化截断 */ }
  try {
    writeFileSync(file, readFileTailBytes(file, Math.floor(maxBytes / 2)));
  } catch { /* 截断失败则保持原文件继续追加 */ }
}

/**
 * 读取文件末尾至多 maxBytes 字节。
 * 起始位置落在多字节字符中间时丢弃残片，因此返回值始终是完整 UTF-8 文本。
 */
export function readFileTailBytes(file: string, maxBytes: number): string {
  const size = statSync(file).size;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length <= 0) return '';
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return dropPartialLeadingChar(buf).toString('utf-8');
  } finally {
    closeSync(fd);
  }
}

/** 丢弃开头的 UTF-8 续接字节（0b10xxxxxx），即被截断字符的剩余部分。 */
function dropPartialLeadingChar(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length && (buf[i] & 0xc0) === 0x80) i += 1;
  return i === 0 ? buf : buf.subarray(i);
}

/**
 * 读取服务日志末尾至多 tailChars 个字符。
 * 按 UTF-8 最长 4 字节反推需读取的字节数，避免为取少量尾部而读入整个文件。
 */
export function readServiceLogTail(logDir: string, id: string, tailChars = 2000): string {
  const file = serviceLogFile(logDir, id);
  if (!existsSync(file)) return '';
  const bytes = Math.min(MAX_READ_BYTES, Math.max(MIN_READ_BYTES, tailChars * 4));
  return readFileTailBytes(file, bytes).slice(-tailChars);
}

export function clearServiceLog(logDir: string, id: string): void {
  try {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(serviceLogFile(logDir, id), '');
  } catch { /* ignore */ }
}
