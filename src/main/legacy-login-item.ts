import { execFile } from 'node:child_process';

/** Windows 登录自启项所在的注册表键 */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
/** 旧版可能使用的自启项值名（Electron 在 Windows 上以应用标识作为值名） */
const LEGACY_VALUES = ['com.local.llama-manager', 'LLaMA 模型管理器'];
/** 值内容需命中的旧标识，避免删掉同名但指向别处的条目 */
const LEGACY_MARKERS = ['llama-manager', 'LLaMA 模型管理器'];

/**
 * 判定一个自启项是否属于旧版安装。
 * 值名与命令任一命中旧标识即视为旧版残留。
 */
export function isLegacyLoginItem(name: string, command: string, markers: string[] = LEGACY_MARKERS): boolean {
  const haystack = `${name} ${command}`.toLowerCase();
  return markers.some((marker) => haystack.includes(marker.toLowerCase()));
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      resolve({ code: err ? 1 : 0, stdout: String(stdout ?? '') });
    });
  });
}

/**
 * 删除旧版遗留的登录自启项。
 * 改名后 Electron 会写入新的值名，旧条目仍指向已卸载的旧安装目录，
 * 登录时会导致找不到文件的报错。仅在值内容确实命中旧标识时删除。
 */
export async function removeLegacyLoginItems(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const removed: string[] = [];
  for (const name of LEGACY_VALUES) {
    const query = await run('reg', ['query', RUN_KEY, '/v', name]);
    if (query.code !== 0) continue;
    if (!isLegacyLoginItem(name, query.stdout)) continue;
    const del = await run('reg', ['delete', RUN_KEY, '/v', name, '/f']);
    if (del.code === 0) removed.push(name);
  }
  return removed;
}
