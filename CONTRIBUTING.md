# Contributing to Accensa

We welcome contributions from the community! Whether it's a bug fix, new feature, or documentation improvement, your help is appreciated.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally.
3. **Find an issue**: Look for issues labeled with `good first issue` if you are a new contributor. If you have an idea for a feature or found a bug, please create a new issue first to discuss it with the maintainers before starting work.
4. **Wait for assignment**: To avoid duplicate work, please express your interest on the issue and wait for a maintainer to assign it to you before starting work.
5. **Create a new branch** for your feature or bug fix (`git checkout -b feature/my-new-feature` or `bugfix/issue-123`).
6. **Make your changes** and test them thoroughly.

## Scratch files

Anything that is tooling residue rather than part of the project — a PR body you
passed to `gh pr create --body-file`, a dump of issue data, a one-off migration
or fix script — goes under `.scratch/` at the repo root. That directory is
`.gitignore`d, so it cannot be committed by accident.

`body.txt` and `issues.json` were both tracked at the repo root once. Do not
re-create that: if you need a file like that, put it in `.scratch/`.

## Code Style

This project uses [Prettier](https://prettier.io/) for code formatting. Before committing, run:

```bash
pnpm format
```

CI will reject unformatted code via `pnpm format:check`.

## Submitting a Pull Request

- Ensure your code follows the existing style conventions.
- Run `pnpm format` to format your code.
- Run `pnpm lint` and `pnpm typecheck` from the workspace root to check for issues.
- Run all local build and test commands (e.g., `pnpm build`, `pnpm test`) before submitting.
- Provide a clear and descriptive PR title and description.
- Link to any relevant open issues in your PR description (e.g. `Closes #123`).
- Wait for a maintainer to review your PR. Address any feedback as needed.

## Reporting Bugs and Requesting Features

If you find a bug or have a feature idea, please open an issue on GitHub using our issue templates.
Include as much detail as possible to help us understand and resolve the issue quickly.

Thank you for helping make Accensa better!
