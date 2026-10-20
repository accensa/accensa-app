# Support

`accensa-app` is the off-chain half of Accensa — the merchant back-office for x402 sellers on Stellar. It is a pnpm workspace containing `apps/web` (the Next.js dashboard and the indexer at `src/app/api/sync`), `packages/sdk` (`@accensa/sdk`), and `apps/demo-merchant`.

This page is the single source of truth for how to reach the Accensa maintainers. Issues, PR templates, and documentation link here rather than embedding chat invites directly, so that if an invite link ever rotates only this file needs to change.

---

## Community channels

| Channel                                    | Best for                                                        |
| ------------------------------------------ | --------------------------------------------------------------- |
| [Telegram](https://t.me/+Gflo5jZStw1jMjE0) | Quick questions, claiming an issue, unblocking mid-PR           |
| [Discord](https://discord.gg/5aprtMSyR)    | Longer design discussion, architecture questions, async threads |

Both channels are staffed by the maintainers. If you are working on a Drips Wave issue and are blocked, use them — a question asked early costs far less than a PR built on a wrong assumption.

---

## Getting help with a contribution

**Before you ask**, the following usually answer the question faster:

- [`README.md`](README.md) — repository layout and local setup
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution workflow and code quality standards
- [`DESIGN.md`](DESIGN.md) — architecture and the reasoning behind it
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — how the app is deployed
- Documentation site (not deployed)

**When you do ask**, include the issue number, what you have already tried, and the exact command and output if something is failing. "It doesn't work" takes several round trips to resolve; a pasted error message usually takes one.

---

## Working on a Drips Wave issue

Accensa participates in the Drips Stellar Wave. If you are contributing through a Wave:

- **Get assigned before you start.** Unassigned PRs are not guaranteed a review slot, and Wave rewards are tied to assignment.
- **Ask early if the issue is ambiguous.** The issue's `## What to build` section states which decisions are yours to make. If something outside that is unclear, ask rather than guess.
- **Your PR description must include `Closes #<issue number>`** so the issue resolves automatically on merge.
- **Run the repo's checks before opening the PR:**

```bash
pnpm install
pnpm lint     # in the affected workspace package
pnpm test     # Vitest
pnpm build    # for apps/web, if your change touches it
```

- **If your PR is merge-blocked for reasons outside your control** — a release freeze, an upstream dependency, a testnet outage — say so in the PR. Maintainers will still resolve the issue before the Wave closes so your contribution is credited.

### One rule specific to this repo

The Soroban contracts live in a separate repository, [`accensa-contracts`](https://github.com/accensa/accensa-contracts). If your change requires a contract change, it belongs in two coordinated PRs, not one — raise it before you build.

---

## Reporting a bug

Open an issue in this repository with reproduction steps, the expected and actual behavior, and your environment. If the bug has security implications, **do not open a public issue** — follow [`SECURITY.md`](SECURITY.md) instead.

## Reporting a vulnerability

See [`SECURITY.md`](SECURITY.md). Please report privately; do not open a public issue or discuss it in the community channels.

---

## What this page does not cover

Maintainers cannot provide production support, integration consulting, or debugging of your own application code. The channels above are for contributing to this repository and for questions about how Accensa itself behaves.
