/**
 * Default heartbeat interval in milliseconds (15 seconds).
 * Well under typical 30-60 second proxy/gateway idle timeouts.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;

/**
 * Start a periodic SSE heartbeat comment frame on an active HTTP response.
 *
 * Reverse proxies, tunnels, and load balancers often close idle HTTP connections
 * after 30-60 seconds. Sending a periodic comment frame (`:\n\n`) keeps the
 * connection warm without delivering events to client-side EventSource listeners.
 *
 * @param {import('http').ServerResponse} res - Connected SSE response stream
 * @param {number} [intervalMs=DEFAULT_HEARTBEAT_INTERVAL_MS] - Interval between frames in ms
 * @returns {() => void} Idempotent stop function that cancels the heartbeat timer
 */
export function startHeartbeat(res, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
  let timer = setInterval(() => {
    res.write(':\n\n');
  }, intervalMs);

  return function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

