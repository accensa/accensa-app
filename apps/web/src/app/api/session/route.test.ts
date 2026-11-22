import { describe, it, expect } from 'vitest';
import { GET } from './route';

/** A request as the gateway proxy forwards it, with an optional role header. */
function request(role?: string): Request {
  return new Request('http://test/api/session', {
    headers: role === undefined ? undefined : { 'x-accensa-role': role },
  });
}

describe('GET /api/session', () => {
  it('reports the admin role from the forwarded header', async () => {
    const res = await GET(request('admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'admin' });
  });

  it('reports the viewer role from the forwarded header', async () => {
    const res = await GET(request('viewer'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'viewer' });
  });

  it('falls back to admin when the header is absent', async () => {
    // Legacy pre-RBAC sessions carry no role claim; `roleFromRequest` treats
    // them as admin so a merchant is never locked out of their own dashboard
    // mid-deployment (see lib/rbac.ts).
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'admin' });
  });

  it('falls back to admin for an unrecognized role value', async () => {
    const res = await GET(request('superuser'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'admin' });
  });

  it('never leaks other response fields', async () => {
    const res = await GET(request('viewer'));
    expect(Object.keys(await res.json())).toEqual(['role']);
  });
});
