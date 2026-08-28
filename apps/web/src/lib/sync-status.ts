import { formatTimestamp } from './format-timestamp';

/** When the indexer last committed progress. Null before it has ever run. */
export interface SyncState {
  lastLedger: number;
  /** ISO 8601. */
  updatedAt: string;
}

/**
 * How much to trust what is on screen.
 *
 * `live` - indexed recently; the table reflects the chain.
 * `lagging` - a sync is overdue but the data is still of the right order.
 * `stale` - old enough that a merchant should not read the total as current.
 * `unknown` - the indexer has never run, or its timestamp is unreadable.
 */
export type SyncLevel = 'live' | 'lagging' | 'stale' | 'unknown';

/**
 * The scheduled sync nominally runs every 5 minutes, but GitHub throttles
 * high-frequency workflows and it lands every 1-3 hours in practice. These
 * thresholds describe observed behaviour rather than the configured schedule,
 * so a normal gap is not reported as a fault.
 */
export const LIVE_WITHIN_MS = 15 * 60 * 1000;
export const LAGGING_WITHIN_MS = 3 * 60 * 60 * 1000;

export interface SyncStatus {
  level: SyncLevel;
  /** Human-readable age, e.g."47m". Empty when the age is unknown. */
  age: string;
  /** Full sentence for a title attribute / screen readers. */
  detail: string;
}

/**
 * Milliseconds left before a manual sync is allowed again, or 0 if it is.
 *
 * Guards a public, unauthenticated trigger, so it fails open only where failing
 * closed would be worse: an absent or unreadable timestamp means the indexer's
 * state is unknown, and refusing forever would leave no way to recover.
 */
export function cooldownRemaining(
  updatedAt: string | null | undefined,
  cooldownMs: number,
  now: number = Date.now(),
): number {
  if (!updatedAt) return 0;
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(updated)) return 0;
  const since = now - updated;
  // A timestamp in the future means clock skew, not a fresh sync; do not let it
  // lock the button out for however long the skew happens to be.
  if (since < 0) return 0;
  return since >= cooldownMs ? 0 : cooldownMs - since;
}

/** Formats a duration as a single coarse unit: 4s, 12m, 3h, 2d. */
export function formatAge(ms: number): string {
  if (ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Describes how current the indexed data is.
 *
 * The dashboard polls every 15s, which says how fresh the *request* is and
 * nothing about how fresh the *data* is. Reporting the poll time as"Live"
 * tells a merchant their totals are current when they can be hours behind, so
 * this is measured from the indexer's own timestamp instead.
 */
export function describeSync(sync: SyncState | null, now: number = Date.now()): SyncStatus {
  if (!sync?.updatedAt) {
    return { level: 'unknown', age: '', detail: 'The indexer has not reported a sync yet.' };
  }

  const updated = Date.parse(sync.updatedAt);
  if (Number.isNaN(updated)) {
    return { level: 'unknown', age: '', detail: 'The indexer reported an unreadable sync time.' };
  }

  // A clock skew between server and browser can put the timestamp slightly in
  // the future; treat that as"just now"rather than showing a negative age.
  const ms = Math.max(0, now - updated);
  const age = formatAge(ms);
  const at = formatTimestamp(updated);

  if (ms <= LIVE_WITHIN_MS) {
    return { level: 'live', age, detail: `Indexed ${age} ago, at ${at}.` };
  }
  if (ms <= LAGGING_WITHIN_MS) {
    return {
      level: 'lagging',
      age,
      detail: `Last indexed ${age} ago, at ${at}. Payments settled since then are not shown yet.`,
    };
  }
  return {
    level: 'stale',
    age,
    detail: `Last indexed ${age} ago, at ${at}. This total is out of date - the sync job may not be running.`,
  };
}
