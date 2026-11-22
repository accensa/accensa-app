import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startHeartbeat,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from '../apps/demo-merchant/lib/sse-heartbeat.js';

function createMockResponse() {
  const writes = [];
  return {
    writes,
    write(chunk) {
      writes.push(chunk);
      return true;
    },
  };
}

test('startHeartbeat writes comment frame on timer interval (#771)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const res = createMockResponse();

  const stop = startHeartbeat(res, 15000);

  assert.equal(res.writes.length, 0, 'No frames written before first interval tick');

  t.mock.timers.tick(15000);
  assert.equal(res.writes.length, 1);
  assert.equal(res.writes[0], ':\n\n', 'Must write identical SSE comment frame (:\\n\\n)');

  t.mock.timers.tick(15000);
  assert.equal(res.writes.length, 2);
  assert.equal(res.writes[1], ':\n\n');

  stop();
});

test('startHeartbeat stop clears interval and stops future writes (#771)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const res = createMockResponse();

  const stop = startHeartbeat(res, 10000);

  t.mock.timers.tick(10000);
  assert.equal(res.writes.length, 1);

  stop();

  // Tick past interval; no more writes should occur
  t.mock.timers.tick(30000);
  assert.equal(res.writes.length, 1, 'No frames written after stop() is called');
});

test('startHeartbeat stop is idempotent and can be safely called multiple times (#771)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const res = createMockResponse();

  const stop = startHeartbeat(res, 5000);

  t.mock.timers.tick(5000);
  assert.equal(res.writes.length, 1);

  // Calling stop twice must not throw or cause errors
  assert.doesNotThrow(() => {
    stop();
    stop();
  });

  t.mock.timers.tick(15000);
  assert.equal(res.writes.length, 1);
});

test('startHeartbeat uses DEFAULT_HEARTBEAT_INTERVAL_MS when interval is omitted (#771)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const res = createMockResponse();

  const stop = startHeartbeat(res);

  assert.equal(DEFAULT_HEARTBEAT_INTERVAL_MS, 15000);

  t.mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS - 1);
  assert.equal(res.writes.length, 0);

  t.mock.timers.tick(1);
  assert.equal(res.writes.length, 1);
  assert.equal(res.writes[0], ':\n\n');

  stop();
});
