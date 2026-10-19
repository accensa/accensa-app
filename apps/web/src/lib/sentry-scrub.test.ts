import { describe, expect, it, vi } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';
import {
  REDACTED_ADDRESS_MARKER,
  SENTRY_DSN,
  SENTRY_TRACES_SAMPLE_RATE,
  STELLAR_ADDRESS_PATTERN,
  scrubStellarPii,
} from './sentry-scrub';

// Set up mock for @sentry/nextjs before importing the config files
const initMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  init: (options: unknown) => initMock(options),
}));

describe('sentry-scrub Stellar PII scrubber (#623)', () => {
  const ADDR_1 = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const ADDR_2 = 'GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6';

  it('redacts an address in event.message', () => {
    const event = {
      message: `Failed payment for account ${ADDR_1}`,
    } as unknown as ErrorEvent;

    const result = scrubStellarPii(event);
    expect(result.message).toBe(`Failed payment for account ${REDACTED_ADDRESS_MARKER}`);
  });

  it('redacts an address in an exception value', () => {
    const event = {
      exception: {
        values: [
          { value: `Connection error with merchant ${ADDR_1}` },
          { value: 'Normal error message' },
        ],
      },
    } as unknown as ErrorEvent;

    const result = scrubStellarPii(event);
    expect(result.exception?.values?.[0]?.value).toBe(
      `Connection error with merchant ${REDACTED_ADDRESS_MARKER}`,
    );
    expect(result.exception?.values?.[1]?.value).toBe('Normal error message');
  });

  it('redacts an address in breadcrumb message', () => {
    const event = {
      breadcrumbs: [
        { message: `Invoking contract for ${ADDR_1}` },
        { message: 'Static log entry' },
      ],
    } as unknown as ErrorEvent;

    const result = scrubStellarPii(event);
    expect(result.breadcrumbs?.[0]?.message).toBe(
      `Invoking contract for ${REDACTED_ADDRESS_MARKER}`,
    );
    expect(result.breadcrumbs?.[1]?.message).toBe('Static log entry');
  });

  it('redacts an address in breadcrumb data field including nested objects and arrays', () => {
    const event = {
      breadcrumbs: [
        {
          message: 'Telemetry details',
          data: {
            actor: ADDR_1,
            count: 42,
            active: true,
            empty: null,
            nested: {
              target: ADDR_2,
              list: [100, ADDR_1, false, null],
            },
          },
        },
      ],
    } as unknown as ErrorEvent;

    const result = scrubStellarPii(event);
    const data = result.breadcrumbs?.[0]?.data as Record<string, unknown>;
    expect(data.actor).toBe(REDACTED_ADDRESS_MARKER);
    expect(data.count).toBe(42);
    expect(data.active).toBe(true);
    expect(data.empty).toBeNull();

    const nested = data.nested as Record<string, unknown>;
    expect(nested.target).toBe(REDACTED_ADDRESS_MARKER);

    const list = nested.list as unknown[];
    expect(list[0]).toBe(100);
    expect(list[1]).toBe(REDACTED_ADDRESS_MARKER);
    expect(list[2]).toBe(false);
    expect(list[3]).toBeNull();
  });

  it('redacts an address in request.url', () => {
    const event = {
      request: {
        url: `https://api.accensa.io/v1/merchants/${ADDR_1}/profile`,
      },
    } as unknown as ErrorEvent;

    const result = scrubStellarPii(event);
    expect(result.request?.url).toBe(
      `https://api.accensa.io/v1/merchants/${REDACTED_ADDRESS_MARKER}/profile`,
    );
  });

  it('redacts several addresses in one string', () => {
    const event = {
      message: `Transfer from ${ADDR_1} to ${ADDR_2} succeeded`,
    } as unknown as ErrorEvent;

    const result = scrubStellarPii(event);
    expect(result.message).toBe(
      `Transfer from ${REDACTED_ADDRESS_MARKER} to ${REDACTED_ADDRESS_MARKER} succeeded`,
    );
  });

  it('behaves according to the pattern for look-alikes, lowercase, and longer base32 strings', () => {
    // 55-character look-alike (G followed by 54 chars) -> not matched
    const shortAddress = 'G' + 'B'.repeat(54);
    const eventShort = { message: shortAddress } as unknown as ErrorEvent;
    expect(scrubStellarPii(eventShort).message).toBe(shortAddress);

    // Lowercase string (starts with lowercase g) -> not matched
    const lowerAddress = 'g' + 'B'.repeat(55);
    const eventLower = { message: lowerAddress } as unknown as ErrorEvent;
    expect(scrubStellarPii(eventLower).message).toBe(lowerAddress);

    // Longer base32 run: G followed by 56 characters. Pattern matches first 56 chars (G + 55).
    const longerAddress = 'G' + 'B'.repeat(56);
    const eventLonger = { message: longerAddress } as unknown as ErrorEvent;
    expect(scrubStellarPii(eventLonger).message).toBe(`${REDACTED_ADDRESS_MARKER}B`);
  });

  it('preserves the exact marker text [REDACTED-ADDRESS]', () => {
    expect(REDACTED_ADDRESS_MARKER).toBe('[REDACTED-ADDRESS]');
  });

  it('passes through events missing any of these fields unchanged', () => {
    const minimalEvent = { event_id: 'test-123' } as unknown as ErrorEvent;
    const result = scrubStellarPii(minimalEvent);
    expect(result).toBe(minimalEvent);
    expect(result.event_id).toBe('test-123');

    // Handles null / undefined event safely
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(scrubStellarPii(null as any)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(scrubStellarPii(undefined as any)).toBeUndefined();
  });

  it('leaves non-string values untouched', () => {
    const event = {
      breadcrumbs: [
        {
          data: {
            num: 12345,
            bool: true,
            nil: null,
            undef: undefined,
          },
        },
      ],
    } as unknown as ErrorEvent;

    const result = scrubStellarPii(event);
    const data = result.breadcrumbs?.[0]?.data as Record<string, unknown>;
    expect(data.num).toBe(12345);
    expect(data.bool).toBe(true);
    expect(data.nil).toBeNull();
    expect(data.undef).toBeUndefined();
  });

  it('does not throw on circular structures', () => {
    const circularObj: Record<string, unknown> = { note: `Address ${ADDR_1}` };
    circularObj.self = circularObj;

    const event = {
      breadcrumbs: [
        {
          message: 'Circular test',
          data: circularObj,
        },
      ],
    } as unknown as ErrorEvent;

    expect(() => scrubStellarPii(event)).not.toThrow();
    expect(circularObj.note).toBe(`Address ${REDACTED_ADDRESS_MARKER}`);
  });

  it('proves every runtime uses the shared scrubber and identical options', async () => {
    initMock.mockClear();

    // Import all three configs to trigger Sentry.init calls
    await import('../../sentry.client.config');
    await import('../../sentry.server.config');
    await import('../../sentry.edge.config');

    expect(initMock).toHaveBeenCalledTimes(3);

    const clientOptions = initMock.mock.calls[0][0];
    const serverOptions = initMock.mock.calls[1][0];
    const edgeOptions = initMock.mock.calls[2][0];

    // Assert DSN and tracesSampleRate are identical across client, server, and edge
    expect(clientOptions.dsn).toBe(SENTRY_DSN);
    expect(serverOptions.dsn).toBe(SENTRY_DSN);
    expect(edgeOptions.dsn).toBe(SENTRY_DSN);

    expect(clientOptions.tracesSampleRate).toBe(SENTRY_TRACES_SAMPLE_RATE);
    expect(serverOptions.tracesSampleRate).toBe(SENTRY_TRACES_SAMPLE_RATE);
    expect(edgeOptions.tracesSampleRate).toBe(SENTRY_TRACES_SAMPLE_RATE);

    // Call each beforeSend with an identical dirty event
    const createDirtyEvent = () =>
      ({
        request: { url: `https://test.local/${ADDR_1}` },
        message: `Error from ${ADDR_2}`,
        breadcrumbs: [{ message: `Breadcrumb ${ADDR_1}` }],
      }) as unknown as ErrorEvent;

    const clientScrubbed = clientOptions.beforeSend(createDirtyEvent());
    const serverScrubbed = serverOptions.beforeSend(createDirtyEvent());
    const edgeScrubbed = edgeOptions.beforeSend(createDirtyEvent());

    expect(clientScrubbed.request?.url).toBe(`https://test.local/${REDACTED_ADDRESS_MARKER}`);
    expect(serverScrubbed.request?.url).toBe(`https://test.local/${REDACTED_ADDRESS_MARKER}`);
    expect(edgeScrubbed.request?.url).toBe(`https://test.local/${REDACTED_ADDRESS_MARKER}`);

    expect(clientScrubbed.message).toBe(`Error from ${REDACTED_ADDRESS_MARKER}`);
    expect(serverScrubbed.message).toBe(`Error from ${REDACTED_ADDRESS_MARKER}`);
    expect(edgeScrubbed.message).toBe(`Error from ${REDACTED_ADDRESS_MARKER}`);

    expect(clientScrubbed.breadcrumbs?.[0]?.message).toBe(`Breadcrumb ${REDACTED_ADDRESS_MARKER}`);
    expect(serverScrubbed.breadcrumbs?.[0]?.message).toBe(`Breadcrumb ${REDACTED_ADDRESS_MARKER}`);
    expect(edgeScrubbed.breadcrumbs?.[0]?.message).toBe(`Breadcrumb ${REDACTED_ADDRESS_MARKER}`);
  });
});
