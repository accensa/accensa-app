import { createHash, createPrivateKey, sign as edSign } from 'node:crypto';
import { logger } from '../log.ts';
import { WebhookSigningError } from './errors.ts';

/**
 * Sign the exact body bytes with the deployment's Ed25519 key. The 32-byte
 * seed is wrapped in its PKCS#8 prefix because node:crypto only signs with a
 * full private key object.
 */
export function signBody(body: string, privateKeyHex: string): string {
  try {
    const keyBuffer = Buffer.from(privateKeyHex, 'hex');
    if (keyBuffer.length !== 32) {
      throw new WebhookSigningError(
        `WEBHOOK_SIGNING_KEY must be a 32-byte Ed25519 private key in hex, got ${keyBuffer.length} bytes`,
      );
    }
    const privateKey = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), keyBuffer]),
      format: 'der',
      type: 'pkcs8',
    });
    const signature = edSign(null, Buffer.from(body, 'utf8'), privateKey).toString('hex');
    logger.debug('Webhook body signed successfully', {
      bodyDigest: createHash('sha256').update(body).digest('hex').slice(0, 8),
    });
    return signature;
  } catch (e) {
    if (e instanceof WebhookSigningError) throw e;
    throw new WebhookSigningError(
      'Failed to sign webhook body',
      e instanceof Error ? e : undefined,
    );
  }
}

/** Hash of the body, useful in tests to assert we signed the bytes we sent. */
export function bodyDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
