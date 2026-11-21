import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PKG_DIR = resolve(import.meta.dirname, '..');

describe('SDK build target and engines floor (issue #766)', () => {
  it('tsup.config.ts targets node22', () => {
    const config = readFileSync(resolve(PKG_DIR, 'tsup.config.ts'), 'utf-8');
    expect(config).toMatch(/target:\s*['"]node22['"]/);
  });

  it('package.json declares engines.node >= 22', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf-8')) as {
      engines?: { node?: string };
    };
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines!.node).toBe('>=22');
  });
});
