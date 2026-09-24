export type * from './types.js';
export { createSeedProvider, SeedProvider, type SeedProviderOptions } from './seed/seed-provider.js';
export {
  DEFAULT_MONTHS,
  DEFAULT_SEED,
  SEED_REPOSITORY_KEYS,
  type GeneratorOptions,
} from './seed/generator.js';
export { SEED_DEVELOPERS, SEED_ORG, SEED_REPOSITORIES } from './seed/fixtures.js';

import type { GitProvider } from './types.js';
import { createSeedProvider } from './seed/seed-provider.js';

/**
 * Provider registry. `DATA_PROVIDER=seed` runs the whole system — sync,
 * metrics, scores, insights, dashboards — with no GitHub account and no
 * network, which is why CI exercises the full pipeline on every push.
 */
export function createProvider(kind: 'seed' | 'github'): GitProvider {
  switch (kind) {
    case 'seed':
      return createSeedProvider();
    case 'github':
      throw new Error('GitHubProvider is implemented in M7 — see ROADMAP.md');
  }
}
