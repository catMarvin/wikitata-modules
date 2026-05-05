/**
 * POST /admin/gen/upload — accept a seed image upload and store as latest anchor.
 * Auto-normalizes to spec aspect via sharp (center cover-crop + resize).
 * Mirrors RWS baseline: api/admin/gen/upload/route.ts.
 *
 * Multipart form fields:
 *   - anchorId: string (must exist in spec)
 *   - file: File (image)
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { SpecStore } from '../../persistence/spec-store.js';
import { normalizeToAspect, type AspectSpec } from '../../lib/normalize.js';

export interface UploadRouteDeps extends RouteDeps {
  specStore: SpecStore;
  aspect: AspectSpec;
}

export function makeUploadHandlers(deps: UploadRouteDeps): { POST: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const form = await req.formData();
        const anchorId = form.get('anchorId');
        const file = form.get('file');
        if (typeof anchorId !== 'string') return errorResponse('anchorId required', 400);
        const spec = await deps.specStore.load();
        if (!spec.anchors.find((a) => a.id === anchorId)) {
          return errorResponse(`unknown anchorId: ${anchorId}`, 400);
        }
        if (!(file instanceof Blob)) return errorResponse('file required', 400);

        const rawBytes = new Uint8Array(await file.arrayBuffer());
        const norm = await normalizeToAspect(rawBytes, deps.aspect);

        const ts = Date.now();
        // Store the active normalized image under the anchor's matchable name.
        const filename = `${anchorId}-${ts}.png`;
        await deps.storage.writeFile(`anchors/${filename}`, norm.bytes);

        // Preserve raw upload under a non-matching name (recoverable, doesn't enter rotation).
        let originalSaved: string | null = null;
        if (!norm.skipped) {
          const ext = (file as File).name?.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
          const rawName = `${anchorId}-original-${ts}.${ext}`;
          await deps.storage.writeFile(`anchors/${rawName}`, rawBytes);
          originalSaved = rawName;
        }

        return jsonResponse({
          ok: true,
          anchorId,
          filename,
          publicUrl: deps.storage.publicUrl(`anchors/${filename}`),
          originalSaved,
          normalized: !norm.skipped,
          inputDims: { width: norm.inputWidth, height: norm.inputHeight },
          outputDims: { width: norm.width, height: norm.height },
        });
      }),
  };
}
