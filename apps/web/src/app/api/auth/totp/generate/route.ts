import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { withClient } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { isAdmin } from '@/lib/rbac';
import { generateTotpSecret, storePendingTotpSecret, hashBackupCodes } from '@/lib/auth/totp';

export const dynamic = 'force-dynamic';

/**
 * Starts (or restarts) TOTP enrollment for the signed-in merchant (#411).
 *
 * Generates a fresh secret, stores it *pending* (inactive until a valid code
 * is verified once), and returns everything the setup modal renders: the
 * otpauth URI as a scannable QR data URL, the secret for manual entry, and
 * the one-time recovery codes. Admin-only — a viewer session must not be
 * able to arm 2FA on an account they do not control.
 */
export async function POST(request: Request) {
  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdmin(request)) {
    return NextResponse.json(
      { error: 'Forbidden: viewer sessions cannot manage two-factor authentication' },
      { status: 403 },
    );
  }

  const enrollment = generateTotpSecret(merchant.address);

  await withClient(async (client) => {
    await storePendingTotpSecret(
      client,
      merchant.id,
      enrollment.secretEncrypted,
      hashBackupCodes(enrollment.backupCodes),
    );
  });

  const qrCodeUrl = await QRCode.toDataURL(enrollment.uri, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: 'M',
  });

  return NextResponse.json({
    secret: enrollment.secret,
    qrCodeUrl,
    backupCodes: enrollment.backupCodes,
  });
}
