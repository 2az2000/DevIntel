import type { TenantClient } from '../db/index.js';
import type { Role } from '../shared/permissions.js';

/**
 * Request augmentation, in one place.
 *
 * Express 5's types expose `global namespace Express` as the augmentation
 * point; augmenting `express-serve-static-core` directly does not resolve under
 * `moduleResolution: Bundler`.
 *
 * NOTE: the imports above are deliberately RELATIVE, not `@db` / `@shared`.
 * Every middleware and controller depends on this file, so if it fails to
 * resolve, the whole API stops typechecking with a misleading
 * "Property 'auth' does not exist on type 'Request'" in a dozen files. Relative
 * imports resolve identically in every tool — tsc, the editor's language
 * server, Vitest — without relying on tsconfig `paths` being honoured.
 */
declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate()` when a valid session cookie is present. */
      auth?: { userId: string; sessionId: string };

      /** Set by `resolveTenant()`. Handlers never see an unscoped client. */
      db?: TenantClient;
      tenant?: { workspaceId: string; role: Role };

      /** Set by `validate()`. Reading anything else is reading unchecked input. */
      validated?: {
        params: unknown;
        query: unknown;
        body: unknown;
      };
    }
  }
}

export {};
