import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The Playwright e2e harness (#202) drives the dev server from 127.0.0.1.
  // Next.js 16's dev-mode CSRF protection rejects requests that carry an
  // Origin header for a host not on this list, which otherwise 403s every
  // `_next/static` chunk in a headless browser.
  allowedDevOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
};

export default nextConfig;