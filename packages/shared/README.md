# @accensa/shared

Shared components, utilities, and types for micro-frontend federation across Accensa applications.

## Purpose

This package serves as the shared layer for Webpack Module Federation. It provides:

- **Shared components** – UI primitives that can be consumed by federated remotes
- **Shared utilities** – Cross-cutting helper functions (event bus, formatting, etc.)
- **Shared types** – TypeScript interfaces that define contracts between micro-frontends

## Structure

```
src/
├── components/   # Shared UI components and component registry
├── utils/        # Cross-cutting utilities (events, formatting)
└── types/        # Shared TypeScript interfaces
```

## Module Federation

This package is configured as a singleton shared dependency in the Module Federation host config (`apps/web/module-federation.config.js`). All federated remotes and the shell host share a single instance to avoid duplication and ensure type safety at runtime.

## Development

```bash
# Type-check
pnpm typecheck

# Lint
pnpm lint
```
