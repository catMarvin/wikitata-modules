/**
 * POST /admin/gen/spec/insert — insert a new anchor at a given index (with
 * default bridge segment) and rebuild segments.
 * POST /admin/gen/spec/delete — delete an anchor by id and rebuild segments.
 *
 * Mirror baseline: api/admin/gen/spec/{insert,delete}/route.ts.
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import { rebuildSegments, type SpecAnchor } from '../../lib/spec.js';
import type { SpecRouteDeps } from './spec.js';

export function makeSpecInsertHandlers(deps: SpecRouteDeps): { POST: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json()) as { afterAnchorId?: string; anchor?: Partial<SpecAnchor> };
        if (!body.anchor || typeof body.anchor.id !== 'string') {
          return errorResponse('anchor.id is required', 400);
        }
        const newAnchor: SpecAnchor = {
          id: body.anchor.id,
          label: body.anchor.label ?? body.anchor.id,
          prompt: body.anchor.prompt ?? '',
          seedFile: body.anchor.seedFile ?? null,
        };
        const spec = await deps.specStore.load();
        if (spec.anchors.some((a) => a.id === newAnchor.id)) {
          return errorResponse(`anchor id "${newAnchor.id}" already exists`, 409);
        }
        const idx = body.afterAnchorId
          ? spec.anchors.findIndex((a) => a.id === body.afterAnchorId)
          : spec.anchors.length - 1;
        const insertAt = idx >= 0 ? idx + 1 : spec.anchors.length;
        const nextAnchors = [
          ...spec.anchors.slice(0, insertAt),
          newAnchor,
          ...spec.anchors.slice(insertAt),
        ];
        const rebuilt = rebuildSegments({ ...spec, anchors: nextAnchors });
        await deps.specStore.save(rebuilt);
        return jsonResponse(rebuilt);
      }),
  };
}

export function makeSpecDeleteHandlers(deps: SpecRouteDeps): { POST: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json()) as { anchorId?: string };
        if (!body.anchorId) return errorResponse('anchorId required', 400);
        const spec = await deps.specStore.load();
        if (!spec.anchors.some((a) => a.id === body.anchorId)) {
          return errorResponse(`anchor "${body.anchorId}" not found`, 404);
        }
        if (spec.anchors.length <= 2) {
          return errorResponse('cannot delete: spec must retain at least 2 anchors', 400);
        }
        const nextAnchors = spec.anchors.filter((a) => a.id !== body.anchorId);
        const rebuilt = rebuildSegments({ ...spec, anchors: nextAnchors });
        await deps.specStore.save(rebuilt);
        return jsonResponse(rebuilt);
      }),
  };
}
