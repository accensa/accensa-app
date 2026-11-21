# Bundle budget — how to measure, and the baseline

The dashboard ships one client bundle and no size gate. `@next/bundle-analyzer`
is wired into `apps/web/next.config.ts:4-7` behind an `ANALYZE` environment
variable, and `apps/web/package.json:7` exposes it as `build:analyze`. That is
the only size tool in `apps/web`; `packages/sdk` has its own
`check-bundle-size`, which measures the SDK, not the dashboard.

**There is no budget gate in CI.** No workflow runs `build:analyze`, no
`size-limit` dependency is installed and no bot comments on pull requests.
`ANALYZE` is a **local switch**: it changes nothing unless you export it, and a
build without it produces the same output as any other `next build`. Nothing in
this page adds a gate — it gives a contributor a command and a baseline to
compare against.

## Produce the report

```bash
pnpm --filter @accensa/sdk build       # apps/web imports @accensa/sdk/*; CI does this first too
pnpm --filter web build:analyze
```

`apps/web/package.json:9` defines `prebuild` as `rm -rf .next`, so every run
starts from a clean build. Do not measure a warm `.next`: the prebuild step
deletes it anyway, and a partial directory would give figures that no one else
can reproduce.

### Where the output lands

Observed on Next.js 16.4.6 (the version in `apps/web/package.json`): the report
is written under `apps/web/.next/analyze/`, one HTML file per build pass.

| File                                 | What it is                                              |
| ------------------------------------ | ------------------------------------------------------- |
| `apps/web/.next/analyze/client.html` | Browser bundle — the one a route's size budget is about |
| `apps/web/.next/analyze/nodejs.html` | Node.js server bundle (route handlers, SSR)             |
| `apps/web/.next/analyze/edge.html`   | Edge bundle (`/api/verify`, pricing, middleware)        |

The directory is **version-dependent** — it moved between Next majors before —
so if these filenames are absent after a successful build, look for the "saved
report to" lines the command prints and treat those paths as current. The
analyzer opens nothing on its own (`openAnalyzer: false` in
`apps/web/next.config.ts:6`); open the HTML file directly.

### Reading the report

`client.html` is a treemap of chunks: area is parsed bytes, not gzip, and the
left-hand tree groups a chunk before its modules. The route table printed by the
build (`Route (app)`) is the index of routes and their render mode (`○` static,
`ƒ` dynamic); on Next 16.4.6 it no longer prints per-route `Size` / `First Load
JS` columns, so route figures have to be measured rather than copied.

The measurement used for the baseline below is the browser's own definition of
first load: serve the production build, request the route's document, and sum
the `/_next/static/**/*.js` files it references (deduplicated, raw and gzip).

## Baseline

Recorded **2026-11-20** from a clean `build:analyze` on `main` at commit
`7d86472` (Next.js 16.4.6, webpack). Route paths are the ones in the build's
`Route (app)` table; `/dashboard` and `/dashboard/routes` need a session cookie
to return a document, `/verify` does not.

| Route               | JS files in the document | Raw                       | Gzip      |
| ------------------- | ------------------------ | ------------------------- | --------- |
| `/dashboard`        | 18                       | 1,476,787 B (1,442.2 KiB) | 430.5 KiB |
| `/dashboard/routes` | 17                       | 1,171,906 B (1,144.4 KiB) | 356.1 KiB |
| `/verify`           | 16                       | 1,170,795 B (1,143.4 KiB) | 354.2 KiB |

These three are the baseline because they are the routes a merchant loads on the
way in and the one public page that renders a verdict. `/merchant/*` is not in
the baseline: it is a second dashboard surface with its own chunks, and adding
it would make a single number stand for two different products.

Treat the figures as a reference point, not a ceiling. A few KiB of drift is
build noise (chunk ids, minifier ordering); a change worth reviewing moves a
route by tens of KiB.

## What a change requires of a reviewer

- Run `pnpm --filter web build:analyze` before and after the change and compare
  the same route set above. `build:analyze` is local-only, so CI will not have
  the numbers for you.
- A route that grows materially must say where the bytes came from (which chunk
  or dependency, visible in `client.html`) and why they are on the critical
  path — not merely that the bundle grew.
- Anything that pushes `/dashboard` further past its baseline needs a stated
  plan for the growth: a dynamic import, a smaller dependency, or an explicit
  decision that the feature is worth it. "It is only a few KB" is not a plan
  when the baseline is already ~430 KiB gzipped.
- No PR may add a CI job, a `size-limit` dependency or a bot comment to enforce
  a budget. That decision is separate from this document.
