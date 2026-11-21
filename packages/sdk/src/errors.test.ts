import { describe, it, expect } from 'vitest';
import {
  AccensaError,
  AccensaAuthError,
  AccensaRateLimitError,
  AccensaTimeoutError,
  AccensaNetworkError,
  AccensaContractError,
  DotenvError,
  DotenvLoadError,
  DotenvParseError,
} from './errors';

describe('AccensaError', () => {
  it('sets name, status, and instanceof chain', () => {
    const error = new AccensaError('base failure', { status: 500 });
    expect(error.name).toBe('AccensaError');
    expect(error.status).toBe(500);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });
});

describe('AccensaAuthError', () => {
  it('keeps the given status and path, and is instanceof AccensaError', () => {
    const error = new AccensaAuthError('forbidden', { status: 403, path: '/api/payments' });
    expect(error.name).toBe('AccensaAuthError');
    expect(error.status).toBe(403);
    expect(error.path).toBe('/api/payments');
    expect(error).toBeInstanceOf(AccensaAuthError);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });
});

describe('AccensaRateLimitError', () => {
  it('always reports status 429 even when constructed without explicit args', () => {
    const error = new AccensaRateLimitError('rate limited');
    expect(error.name).toBe('AccensaRateLimitError');
    expect(error.status).toBe(429);
    expect(error).toBeInstanceOf(AccensaRateLimitError);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });

  it('carries retryAfterMs and path when given', () => {
    const error = new AccensaRateLimitError('too many', {
      path: '/api/routes',
      retryAfterMs: 2000,
    });
    expect(error.path).toBe('/api/routes');
    expect(error.retryAfterMs).toBe(2000);
  });
});

describe('AccensaTimeoutError', () => {
  it('has undefined status and correct name', () => {
    const error = new AccensaTimeoutError('timed out');
    expect(error.name).toBe('AccensaTimeoutError');
    expect(error.status).toBeUndefined();
    expect(error).toBeInstanceOf(AccensaTimeoutError);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });
});

describe('AccensaNetworkError', () => {
  it('keeps the url and is instanceof AccensaError', () => {
    const error = new AccensaNetworkError('fetch failed', { url: 'https://indexer.example.com' });
    expect(error.name).toBe('AccensaNetworkError');
    expect(error.url).toBe('https://indexer.example.com');
    expect(error).toBeInstanceOf(AccensaNetworkError);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });
});

describe('AccensaContractError', () => {
  it('keeps index and the exact message', () => {
    const error = new AccensaContractError('row at index 2 is malformed', { index: 2 });
    expect(error.name).toBe('AccensaContractError');
    expect(error.message).toBe('row at index 2 is malformed');
    expect(error.index).toBe(2);
    expect(error).toBeInstanceOf(AccensaContractError);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });
});

describe('DotenvError', () => {
  it('keeps filePath and is instanceof AccensaError', () => {
    const error = new DotenvError('dotenv failure', '/app/.env');
    expect(error.name).toBe('DotenvError');
    expect(error.filePath).toBe('/app/.env');
    expect(error).toBeInstanceOf(DotenvError);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });
});

describe('DotenvLoadError', () => {
  it('keeps filePath and a null offendingLine for a missing file', () => {
    const error = new DotenvLoadError('file not found', '/app/.env', null);
    expect(error.name).toBe('DotenvLoadError');
    expect(error.filePath).toBe('/app/.env');
    expect(error.offendingLine).toBeNull();
    expect(error).toBeInstanceOf(DotenvLoadError);
    expect(error).toBeInstanceOf(DotenvError);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });
});

describe('DotenvParseError', () => {
  it('keeps filePath and a numeric offendingLine', () => {
    const error = new DotenvParseError('invalid KEY=value at line 5', '/app/.env', 5);
    expect(error.name).toBe('DotenvParseError');
    expect(error.filePath).toBe('/app/.env');
    expect(error.offendingLine).toBe(5);
    expect(error).toBeInstanceOf(DotenvParseError);
    expect(error).toBeInstanceOf(DotenvError);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).toBeInstanceOf(Error);
    expect('code' in error).toBe(false);
  });
});
