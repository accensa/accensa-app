import type { NextConfig } from 'next';
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

const nextConfig: NextConfig = {
  // The Playwright e2e harness (#202) drives the dev server from 127.0.0.1.
  // Next.js 16's dev-mode CSRF protection rejects requests that carry an
  // Origin header for a host not on this list, which otherwise 403s every
  // `_next/static` chunk in a headless browser. Values are hostnames (or
  // wildcard hostnames), not full URLs — the request's Origin hostname is
  // compared against them directly.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  experimental: {
    sri: {
      algorithm: 'sha256',
    },
  },
};

export default withBundleAnalyzer(nextConfig);
