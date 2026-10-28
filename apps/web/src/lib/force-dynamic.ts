import type { GetServerSideProps } from 'next';

/**
 * Opts a Pages Router page into server rendering.
 *
 * The app ships a per-request nonce CSP (see `src/proxy.ts`). Next.js can
 * only attach that nonce to a page's scripts while the page is rendered for a
 * request. A statically prerendered page has no request to read the nonce
 * from, so its scripts carry none, and the browser blocks them under
 * `script-src ... 'strict-dynamic'` — the HTML renders but the page never
 * hydrates.
 *
 * Every page the CSP protects therefore has to be server-rendered. This
 * helper is the Pages Router's way of saying so.
 */
export const forceDynamic: GetServerSideProps = async () => ({ props: {} });
