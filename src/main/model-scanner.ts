import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ModelEntry {
  path: string;
  name: string;
  sizeBytes: number;
  siblingMmproj: string | null;
}

let scanCache: { at: number; value: ModelEntry[] } = { at: 0, value: [] };

export function scanModels(scanRoots: string[], ttlMs = 10000): ModelEntry[] {
  if (Date.now() - scanCache.at < ttlMs) return scanCache.value;
  const results: ModelEntry[] = [];
  const seen = new Set<string>();

  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const mmprojs = entries
      .filter((e) => e.isFile() && /^mmproj.*\.gguf$/i.test(e.name))
      .map((e) => join(dir, e.name));
    for (const e of entries) {
      if (e.isDirectory()) {
        walk(join(dir, e.name), depth + 1);
        continue;
      }
      if (!e.isFile() || !/\.gguf$/i.test(e.name) || /^mmproj/i.test(e.name)) continue;
      const full = join(dir, e.name);
      if (seen.has(full)) continue;
      seen.add(full);
      let size = 0;
      try { size = statSync(full).size; } catch { /* unreadable */ }
      results.push({ path: full, name: e.name, sizeBytes: size, siblingMmproj: mmprojs[0] ?? null });
    }
  };

  for (const root of scanRoots ?? []) {
    if (root && typeof root === 'string') walk(root, 0);
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  scanCache = { at: Date.now(), value: results };
  return results;
}
