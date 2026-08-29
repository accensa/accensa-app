import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { withClient, withMerchantClient } from '@/lib/db';
import { getMerchantFromRequest, updateMerchantProfile, type Merchant } from '@/lib/merchants';
import { recordMerchantConfigChange } from '@/lib/merchant-config';
import {
  getCachedMerchantFromRequest,
  merchantProfileCacheTag,
  parseMerchantProfileUpdate,
} from '@/lib/merchant-profile';

/**
 * Serves the merchant's own profile (signing key, asset watch-list, refund
 * vault, webhook URL) from Next.js's Data Cache instead of Postgres on every
 * dashboard load, and invalidates that cache the moment the profile changes.
 */

export interface MerchantProfileResponse {
  profile: Merchant;
}

export async function GET(request: Request) {
  const merchant = await getCachedMerchantFromRequest(request);
  if (!merchant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json<MerchantProfileResponse>({ profile: merchant });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const parsed = parseMerchantProfileUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const caller = await withClient((client) => getMerchantFromRequest(client, request));
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profile = await withMerchantClient(caller.id, async (client) => {
    const updated = await updateMerchantProfile(client, caller.id, parsed.update);

    // Record immutable history for each field that changed, so configuration
    // changes can be tracked over time (historical merchant configuration).
    if (updated) {
      const changedFields = Object.entries(parsed.update) as [
        keyof NonNullable<typeof parsed.update>,
        string | string[] | null,
      ][];
      for (const [field, value] of changedFields) {
        await recordMerchantConfigChange(client, {
          merchantId: caller.id,
          field,
          before: null,
          after: Array.isArray(value) ? value.join(',') : value,
          source: 'profile_patch',
        });
      }
    }

    return updated;
  });

  // `{ expire: 0 }` expires the tag immediately rather than the
  // stale-while-revalidate behaviour of `revalidateTag(tag, 'max')`, which
  // would still serve one more stale read before fetching fresh data - this
  // route needs the very next read to see the write.
  revalidateTag(merchantProfileCacheTag(caller.address), { expire: 0 });

  return NextResponse.json<MerchantProfileResponse>({ profile: profile as Merchant });
}
