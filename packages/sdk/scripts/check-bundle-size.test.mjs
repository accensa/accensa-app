import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomFillSync } from 'node:crypto';
import { checkBundleSize } from './check-bundle-size.mjs';

const LIMIT = 45 * 1024; // 45 kB

function writeTmp(buf) {
  const p = join(tmpdir(), `bundle-test-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  writeFileSync(p, buf);
  return p;
}

describe('checkBundleSize', () => {
  const tmps = [];

  afterEach(() => {
    while (tmps.length) {
      try { unlinkSync(tmps.pop()); } catch { /* already removed */ }
    }
  });

  it('rejects a 70,000-byte incompressible fixture (gzipped > 45 kB)', () => {
    // Use cryptographically random bytes — gzip cannot compress random data,
    // so 70,000 bytes will gzip to > 46,080 bytes (45 kB limit).
    const buf = Buffer.allocUnsafe(70_000);
    randomFillSync(buf);
    const p = writeTmp(buf);
    tmps.push(p);

    const result = checkBundleSize(p);
    expect(result.gzippedBytes).toBeGreaterThan(LIMIT);
    expect(result.passed).toBe(false);
  });

  it('accepts a 200,000-byte all-same-character fixture (highly compressible)', () => {
    const buf = Buffer.alloc(200_000, 0x61); // 'a' × 200k
    const p = writeTmp(buf);
    tmps.push(p);

    const result = checkBundleSize(p);
    expect(result.gzippedBytes).toBeLessThan(LIMIT);
    expect(result.passed).toBe(true);
  });

  it('returns rawBytes matching actual file size', () => {
    const buf = Buffer.alloc(1_000, 0x62);
    const p = writeTmp(buf);
    tmps.push(p);

    const result = checkBundleSize(p);
    expect(result.rawBytes).toBe(1_000);
    expect(result.limit).toBe(LIMIT);
  });
});
