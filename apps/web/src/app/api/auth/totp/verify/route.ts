import { NextResponse } from 'next/server';
import { withClient } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import {
  activateTotp,
  redeemBackupCode,
  decryptTotpSecret,
  verifyTotpToken,
  isTotpEnabled,
  disableTotp,
  getTotpRecord,
} from '@/lib/auth/totp';
import { mintChallengeToken } from '@/lib/auth/totp-challenge';
import { checkTotpRateLimit, clearTotpAttempts } from '@/lib/auth/totp-rate-limit';

export const dynamic = 'force-dynamic';

/** How long a minted challenge token stays valid — mirrors `totp-challenge.ts`. */
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * Verifies a TOTP code or backup code for the signed-in merchant (#411).
 *
 * Three jobs in one endpoint, because the modal and the mutation flows all
 * speak "code in, proof out":
 *
 * 1. `activate: true` — completes the setup modal: the pending secret is
 *    verified once and the enrollment becomes active.
 * 2. `disable: true` — the teardown challenge: a valid code (authenticator
 *    or an unredeemed backup code) deletes the enrollment.
 * 3. Otherwise — a 2FA challenge ahead of a sensitive mutation: on success
 *    the route returns a short-lived signed token the client echoes back in
 *    the `x-accensa-2fa` header of the mutation request (see
 *    `lib/auth/totp-challenge.ts`).
 *
 * Every attempt is rate-limited per merchant *before* the code is evaluated,
 * so a blocked caller learns nothing about whether a code would have been
 * valid. Backup codes are redeemed (single-use) inside the same call; a
 * `codeUsed: 'backup'` response tells the client that one recovery code is
 * now spent.
 */
export async function POST(request: Request) {
  let body: { token?: unknown; activate?: unknown; disable?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!/^\d{6}$/.test(token) && !/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(token)) {
    return NextResponse.json(
      { error: 'token must be a 6-digit code or a AAAA-BBBB backup code' },
      { status: 400 },
    );
  }

  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await checkTotpRateLimit(merchant.id);
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait five minutes and try again.' },
      { status: 429 },
    );
  }

  try {
    // --- Teardown: the challenge must be satisfied, then the row goes.
    if (body.disable === true) {
      const enabled = await withClient((client) => isTotpEnabled(client, merchant.id));
      if (!enabled) {
        return NextResponse.json(
          { error: 'Two-factor authentication is not enabled' },
          { status: 400 },
        );
      }
      const satisfied = await withClient(async (client) => {
        const rec = await getTotpRecord(client, merchant.id);
        if (!rec) return false;
        if (await redeemBackupCode(client, merchant.id, token)) return true;
        try {
          return verifyTotpToken(token, decryptTotpSecret(rec.secretEncrypted));
        } catch {
          return false;
        }
      });
      if (!satisfied) {
        return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
      }
      await withClient((client) => disableTotp(client, merchant.id));
      await clearTotpAttempts(merchant.id);
      return NextResponse.json({ success: true, disabled: true });
    }

    // --- Activation: completes the setup modal.
    if (body.activate === true) {
      const result = await withClient((client) => activateTotp(client, merchant.id, token));
      if (!result.ok) {
        // Not enrolled is a client-flow mistake (400); a wrong code (401) is
        // an auth failure and consumes one rate-limit attempt either way.
        const status = result.reason === 'not_enrolled' ? 400 : 401;
        return NextResponse.json({ error: 'Invalid code' }, { status });
      }
      await clearTotpAttempts(merchant.id);
      return NextResponse.json({ success: true, activated: true });
    }

    // --- Challenge: issue a short-lived proof for a sensitive mutation.
    if (!(await withClient((client) => isTotpEnabled(client, merchant.id)))) {
      return NextResponse.json(
        { error: 'Two-factor authentication is not enabled' },
        { status: 400 },
      );
    }

    const secret = await withClient(async (client) => {
      const rec = await getTotpRecord(client, merchant.id);
      if (!rec) return null;
      try {
        return decryptTotpSecret(rec.secretEncrypted);
      } catch {
        return null;
      }
    });

    // Try the authenticator code first, then fall back to a backup code. The
    // backup redemption consumes the code only when its guarded UPDATE wins,
    // so a replayed code fails even across concurrent submissions.
    let usedBackup = false;
    const totpOk = secret !== null && verifyTotpToken(token, secret);
    if (!totpOk) {
      if (await withClient((client) => redeemBackupCode(client, merchant.id, token))) {
        usedBackup = true;
      } else {
        return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
      }
    }

    await clearTotpAttempts(merchant.id);
    return NextResponse.json({
      success: true,
      codeUsed: usedBackup ? 'backup' : 'totp',
      challengeToken: mintChallengeToken(merchant.id),
      expiresInMs: CHALLENGE_TTL_MS,
    });
  } catch (error: unknown) {
    console.error('TOTP verification error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
