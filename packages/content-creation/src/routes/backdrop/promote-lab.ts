/**
 * POST /admin/gen/promote-lab — promote a lab variant into an anchor slot.
 * Mirrors RWS baseline: api/admin/gen/promote-lab/route.ts.
 *
 * Behavior: copies `lab/<labFilename>` → `anchors/<anchorId>-<ts>.png` so the
 * anchor matcher picks it up. Lab files are produced by Image Lab transforms
 * (img2img variants); promoting one makes it the active anchor.
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { SpecStore } from '../../persistence/spec-store.js';

export interface PromoteLabRouteDeps extends RouteDeps {
  specStore: SpecStore;
}

export function makePromoteLabHandlers(deps: PromoteLabRouteDeps): { POST: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json()) as { labFilename?: string; anchorId?: string };
        if (!body.labFilename || !body.anchorId) {
          return errorResponse('labFilename + anchorId required', 400);
        }
        const spec = await deps.specStore.load();
        if (!spec.anchors.find((a) => a.id === body.anchorId)) {
          return errorResponse(`unknown anchorId: ${body.anchorId}`, 400);
        }

        // Strip any path traversal — only the basename is honored.
        const labBase = body.labFilename.replace(/^.*[\\/]/, '');
        const ts = Date.now();
        const destFilename = `${body.anchorId}-${ts}.png`;

        await deps.storage.copyFile(`lab/${labBase}`, `anchors/${destFilename}`);
        return jsonResponse({
          ok: true,
          anchorId: body.anchorId,
          filename: destFilename,
          publicUrl: deps.storage.publicUrl(`anchors/${destFilename}`),
        });
      }),
  };
}
