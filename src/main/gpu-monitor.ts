import { spawn } from 'node:child_process';

export interface GpuInfo {
  usedMB: number;
  totalMB: number;
}

let vramCache: { at: number; value: GpuInfo | null } = { at: 0, value: null };

export function sampleVram(): Promise<GpuInfo | null> {
  if (Date.now() - vramCache.at < 2000) return Promise.resolve(vramCache.value);
  return new Promise((resolve) => {
    try {
      const child = spawn(
        'nvidia-smi',
        ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
      child.on('error', () => {
        vramCache = { at: Date.now(), value: null };
        resolve(null);
      });
      child.on('close', () => {
        const line = out.trim().split(/\r?\n/)[0] ?? '';
        const parts = line.split(',').map((s) => parseInt(s.trim(), 10));
        if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
          vramCache = { at: Date.now(), value: { usedMB: parts[0], totalMB: parts[1] } };
        } else {
          vramCache = { at: Date.now(), value: null };
        }
        resolve(vramCache.value);
      });
    } catch {
      vramCache = { at: Date.now(), value: null };
      resolve(null);
    }
  });
}
