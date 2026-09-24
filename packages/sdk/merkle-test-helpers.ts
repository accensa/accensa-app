import { createHash } from 'node:crypto';

/** Utility function to compute SHA-256 hash buffer of input buffer. */
export const sha256 = (buf: Buffer): Buffer => createHash('sha256').update(buf).digest();

/** Utility function to compute hex SHA-256 hash of a UTF-8 string label. */
export const leafOf = (label: string): string =>
  sha256(Buffer.from(label, 'utf8')).toString('hex');

/** Standard 32-byte valid hex string for mock test parameters. */
export const VALID = 'a'.repeat(64);

/** Generates an array of leaf hashes for testing bulk batch creation. */
export const generateTestLeaves = (count: number, prefix = 'bulk-receipt'): string[] =>
  Array.from({ length: count }, (_, i) => leafOf(`${prefix}-${i}`));
