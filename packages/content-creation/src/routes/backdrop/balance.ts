/**
 * GET /admin/gen/balance — gateway usage / remaining credit.
 * Mirrors RWS baseline: api/admin/gen/balance/route.ts.
 */

import { jsonResponse, withAdmin, type RouteDeps, type RouteHandler } from '../types.js';

export function makeBalanceHandlers(deps: RouteDeps): { GET: RouteHandler } {
  return {
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        const usage = await deps.ai.getUsage();
        return jsonResponse({ ok: true, ...usage });
      }),
  };
}
