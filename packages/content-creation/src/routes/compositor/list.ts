/**
 * GET /admin/compositor/list — list compositions (id, slug, name, updatedAt).
 * Mirrors RWS baseline: api/admin/compositor/list/route.ts.
 */

import { jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { CompositionStore } from '../../persistence/composition-store.js';

export interface CompositorListRouteDeps extends RouteDeps {
  compositionStore: CompositionStore;
}

export function makeCompositorListHandlers(deps: CompositorListRouteDeps): { GET: RouteHandler } {
  return {
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        const all = await deps.compositionStore.list();
        const summary = all.map((c) => ({ id: c.id, slug: c.slug, name: c.name, updatedAt: c.updatedAt }));
        return jsonResponse({ compositions: summary });
      }),
  };
}
