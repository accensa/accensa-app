/**
 * Shared UI components for micro-frontend federation.
 *
 * These components will be exposed as Module Federation remote entries
 * once domain-specific applications are extracted into separate builds.
 */

export interface ComponentConfig {
  /** Unique identifier for the component within the federated scope. */
  id: string;
  /** Display name used in dev tools and error boundaries. */
  displayName: string;
  /** Semantic version string. */
  version: string;
}

export function defineComponent(config: ComponentConfig): ComponentConfig {
  return config;
}
