import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Guardia estática: ningún código que DECIDE (game-math, server) puede usar Math.random(). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('sin Math.random en código que decide', () => {
  const roots = ['../src', '../../server/src'].map((r) => new URL(r, import.meta.url).pathname);
  it.each(roots)('%s', (root) => {
    const offenders = files(root).filter((f) => /Math\.random\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
