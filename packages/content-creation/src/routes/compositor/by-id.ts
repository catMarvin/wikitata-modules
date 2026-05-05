/**
 * GET / POST / DELETE /admin/compositor/:id — single composition CRUD.
 * Mirrors RWS baseline: api/admin/compositor/[id]/route.ts.
 *
 * The handler signature here is a factory that accepts the resolved id (since
 * Web-standard handlers don't have framework-specific param routing). Consumer
 * extracts id from their framework's params and passes it.
 *
 * Usage in Next.js App Router:
 *   export async function GET(req, { params }) {
 *     const { id } = await params;
 *     return routes.compositorById.GET(id)(req);
 *   }
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { CompositionStore } from '../../persistence/composition-store.js';
import type { Composition } from '../../lib/composition.js';

export interface CompositorByIdRouteDeps extends RouteDeps {
  compositionStore: CompositionStore;
}

export interface CompositorByIdHandlers {
  GET: (id: string) => RouteHandler;
  POST: (id: string) => RouteHandler;
  DELETE: (id: string) => RouteHandler;
}

export function makeCompositorByIdHandlers(deps: CompositorByIdRouteDeps): CompositorByIdHandlers {
  return {
    GET: (id) => (req) =>
      withAdmin(req, deps.auth, async () => {
        const comp = await deps.compositionStore.get(id);
        if (!comp) return errorResponse('not found', 404);
        return jsonResponse(comp);
      }),
    POST: (id) => (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json()) as Composition;
        if (body.id !== id) return errorResponse('id mismatch', 400);
        const saved = await deps.compositionStore.upsert(body);
        return jsonResponse(saved);
      }),
    DELETE: (id) => (req) =>
      withAdmin(req, deps.auth, async () => {
        await deps.compositionStore.remove(id);
        return jsonResponse({ ok: true });
      }),
  };
}
