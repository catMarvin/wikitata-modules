/**
 * GET /admin/gen/models — list curated AI models.
 * Mirrors RWS baseline: api/admin/gen/models/route.ts.
 */

import { jsonResponse, withAdmin, type RouteDeps, type RouteHandler } from '../types.js';

export function makeModelsHandlers(deps: RouteDeps): { GET: RouteHandler } {
  return {
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        const models = await deps.ai.listModels();
        return jsonResponse({ ok: true, models });
      }),
  };
}
