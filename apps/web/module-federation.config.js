/**
 * Webpack Module Federation configuration for the Accensa web application.
 *
 * This config defines the host (shell) application that will consume
 * federated remote modules from domain-specific micro-frontends.
 *
 * Usage:
 *   - In next.config.ts, import this config and merge with webpack config
 *   - Each remote entry points to a separate Next.js or standalone build
 *   - Shared packages (@accensa/shared) are singleton to avoid duplication
 */

/** @type {import('@module-federation/enhanced').ModuleFederationPluginOptions} */
const moduleFederationConfig = {
  name: 'accensa_shell',
  filename: 'static/chunks/remoteEntry.js',

  remotes: {
    // Domain remotes will be registered here as they are extracted.
    // Example:
    // payments_domain: 'payments_domain@/_next/static/chunks/remoteEntry.js',
    // settings_domain: 'settings_domain@/_next/static/chunks/remoteEntry.js',
  },

  shared: {
    // Core shared dependencies across all federated modules
    react: {
      singleton: true,
      requiredVersion: '^19.0.0',
      eager: false,
    },
    'react-dom': {
      singleton: true,
      requiredVersion: '^19.0.0',
      eager: false,
    },
    // Accensa shared primitives
    '@accensa/shared': {
      singleton: true,
      requiredVersion: '^0.1.0',
      eager: true,
    },
  },

  // Exposes shared components and types from this shell app
  exposes: {
    './ShellLayout': './src/components/ShellLayout',
    './ThemeProvider': './src/components/ThemeProvider',
  },
};

export default moduleFederationConfig;
