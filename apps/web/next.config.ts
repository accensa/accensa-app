import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The Playwright e2e harness (#202) drives the dev server from 127.0.0.1.
  // Next.js 16's dev-mode CSRF protection rejects requests that carry an
  // Origin header for a host not on this list, which otherwise 403s every
  // `_next/static` chunk in a headless browser. Values are hostnames (or
  // wildcard hostnames), not full URLs — the request's Origin hostname is
  // compared against them directly.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
