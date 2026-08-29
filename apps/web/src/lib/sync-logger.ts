/**
 * Structured failure logging and optional alerting for the indexer's sync
 * job (#135).
 *
 * Before this, a sync failure surfaced as a bare `console.error('Error
 * during sync:', error)` with no ledger context, and one merchant's failure
 * aborted the whole batch — later merchants in the same run were silently
 * never attempted, leaving a gap with nothing pointing at it.
 *
 * No external observability SaaS is wired in here: every major hosting
 * platform (Vercel included) already captures stderr into its own log
 * viewer, keyed on timestamp, so one structured JSON line per failure is
 * enough to answer "which block failed and why" without requiring a DSN or
 * third-party account before this can ship. `SYNC_ALERT_WEBHOOK_URL`, if
 * set, additionally pushes the same context to a Discord or Slack channel.
 */

/** Where a sync failure happened, as much as is known at the point it was caught. */
export interface SyncFailureContext {
  /** The merchant whose sync failed, or omitted for a failure before any merchant was reached. */
  merchant?: string;
  /** The ledger window being read when the failure occurred, if known. */
  startLedger?: number;
  endLedger?: number;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}

/** Recursively unwraps `Error.cause` so a wrapped RPC error keeps its own stack. */
function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return { name: 'NonErrorThrown', message: String(error) };
}

/**
 * Logs a sync failure as one structured JSON line: the merchant, the exact
 * ledger window being processed (when known), and the full error including
 * its stack trace and any wrapped cause.
 */
export function logSyncFailure(context: SyncFailureContext, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'sync_failure',
      ts: new Date().toISOString(),
      ...context,
      error: serializeError(error),
    }),
  );
}

/**
 * Best-effort alert to a Discord or Slack incoming webhook, gated by
 * `SYNC_ALERT_WEBHOOK_URL`. The body carries both `content` (Discord) and
 * `text` (Slack) with the same message, so either service accepts it without
 * needing to know which one is configured.
 *
 * Never throws — a notification channel being down must not affect the sync
 * job, which is why this is called separately from, not instead of,
 * `logSyncFailure`.
 */
export async function notifySyncFailure(
  context: SyncFailureContext,
  error: unknown,
): Promise<void> {
  const webhookUrl = process.env.SYNC_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const where =
    context.startLedger !== undefined
      ? ` (ledgers ${context.startLedger}-${context.endLedger ?? context.startLedger})`
      : '';
  const who = context.merchant ? ` for merchant ${context.merchant}` : '';
  const reason = error instanceof Error ? error.message : String(error);
  const message = `🚨 Indexer sync failed${who}${where}: ${reason}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message, text: message }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // A notification channel being unreachable must not fail the sync job.
  }
}
