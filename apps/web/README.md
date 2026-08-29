This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Security

The dashboard and API routes are secured using a Stellar Wallet Auth model (similar to SEP-10). Merchants must prove control of the configured `MERCHANT_ADDRESS` by signing a challenge using Freighter to access the dashboard.

See [SECURITY.md](./SECURITY.md) and [DESIGN.md](./DESIGN.md) for full details on the access model and session handling.

## Configuration

Environment variables prefixed `NEXT_PUBLIC_` are exposed to the browser.

| Variable                      | Values                                             | Default                           | Purpose                                                                                                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet`, `mainnet` (aliases: `public`, `pubnet`) | `testnet`, with a console warning | Network that block-explorer links (stellar.expert) point at. Set it to `mainnet` for a production deployment — otherwise every transaction and contract link resolves to a testnet page for something that only exists on mainnet. An unrecognised value fails fast at startup. |

Other required server-side variables (`DATABASE_URL`, `MERCHANT_ADDRESS`, `STELLAR_NETWORK_PASSPHRASE`, …) are described in [SECURITY.md](./SECURITY.md) and [DESIGN.md](./DESIGN.md).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
