/**
 * GET / POST /admin/gen/spec — read or replace the runtime Backdrop spec.
 * Mirrors RWS baseline: api/admin/gen/spec/route.ts.
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { SpecStore } from '../../persistence/spec-store.js';
import { assertValidSpec } from '../../lib/spec.js';
import type { RouteDeps } from '../types.js';

export interface SpecRouteDeps extends RouteDeps {
  specStore: SpecStore;
}

export function makeSpecHandlers(deps: SpecRouteDeps): { GET: RouteHandler; POST: RouteHandler } {
  return {
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        const spec = await deps.specStore.load();
        return jsonResponse(spec);
      }),
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = await req.json();
        try {
          assertValidSpec(body);
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : 'invalid spec', 400);
        }
        const rebuilt = await deps.specStore.saveAndRebuild(body);
        return jsonResponse(rebuilt);
      }),
  };
}
