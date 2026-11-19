import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcCall, MAX_RETRY_AFTER_MS } from './rpc.mjs';

const ok = (result) => ({ ok: true, status: 200, json: async () => ({ result }) });
const http = (status, headers = {}) => ({
  ok: false,
  status,
  headers: new Headers(headers),
  json: async () => ({}),
});

function harness(responses) {
  const calls = [];
  const delays = [];
  const fetchImpl = async () => {
    calls.push(1);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const sleepImpl = async (ms) => {
    delays.push(ms);
  };
  return { calls, delays, opts: { fetchImpl, sleepImpl } };
}

test('HTTP 400 is not retried and names method and status', async () => {
  const h = harness([http(400), http(400), http(400)]);
  await assert.rejects(rpcCall('u', 'getEvents', {}, h.opts), /getEvents.*HTTP 400/);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.delays, []);
});

test('HTTP 404 is not retried', async () => {
  const h = harness([http(404), http(404)]);
  await assert.rejects(rpcCall('u', 'nope', {}, h.opts), /nope.*HTTP 404/);
  assert.equal(h.calls.length, 1);
});

test('JSON-RPC error body is not retried', async () => {
  const bad = { ok: true, status: 200, json: async () => ({ error: { message: 'bad params' } }) };
  const h = harness([bad, bad, bad]);
  await assert.rejects(rpcCall('u', 'getEvents', {}, h.opts), /getEvents: bad params/);
  assert.equal(h.calls.length, 1);
});

test('HTTP 500 is tried maxAttempts times with exponential delays, then rejects with last status', async () => {
  const h = harness([http(500), http(502), http(503)]);
  await assert.rejects(rpcCall('u', 'getEvents', {}, h.opts), /HTTP 503/);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.delays, [400, 800]);
});

test('maxAttempts is honoured', async () => {
  const h = harness([http(500), http(500), http(500), http(500), http(500)]);
  await assert.rejects(rpcCall('u', 'm', {}, { ...h.opts, maxAttempts: 5 }), /HTTP 500/);
  assert.equal(h.calls.length, 5);
});

test('429 then 200 resolves on the second call', async () => {
  const h = harness([http(429), ok('done')]);
  assert.equal(await rpcCall('u', 'm', {}, h.opts), 'done');
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.delays, [400]);
});

test('Retry-After is honoured', async () => {
  const h = harness([http(429, { 'retry-after': '2' }), ok(1)]);
  await rpcCall('u', 'm', {}, h.opts);
  assert.deepEqual(h.delays, [2000]);
});

test('Retry-After is capped at MAX_RETRY_AFTER_MS', async () => {
  const h = harness([http(503, { 'retry-after': '3600' }), ok(1)]);
  await rpcCall('u', 'm', {}, h.opts);
  assert.deepEqual(h.delays, [MAX_RETRY_AFTER_MS]);
});

test('transport errors are retried', async () => {
  const h = harness([new TypeError('fetch failed'), ok('fine')]);
  assert.equal(await rpcCall('u', 'm', {}, h.opts), 'fine');
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.delays, [400]);
});

test('an unreadable body is retried as a transport failure', async () => {
  const broken = {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('aborted');
    },
  };
  const h = harness([broken, ok('fine')]);
  assert.equal(await rpcCall('u', 'm', {}, h.opts), 'fine');
  assert.equal(h.calls.length, 2);
});
