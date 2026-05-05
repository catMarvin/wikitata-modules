/**
 * POST /admin/gen/normalize-anchor — re-normalize the latest file for an anchor.
 * Mirrors RWS baseline: api/admin/gen/normalize-anchor/route.ts.
 *
 * Reads the latest anchor file via storage.listDir, runs sharp normalize to
 * spec aspect, writes the normalized version with a fresh timestamp, and
 * preserves the original under a non-matching `<id>-original-<ts>.<ext>` name.
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { SpecStore } from '../../persistence/spec-store.js';
import { normalizeToAspect, type AspectSpec } from '../../lib/normalize.js';

export interface NormalizeAnchorRouteDeps extends RouteDeps {
  specStore: SpecStore;
  aspect: AspectSpec;
}

function findLatestAnchor(filenames: string[], anchorId: string): string | undefined {
  const safe = anchorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${safe}-(\\d{10,})\\.(png|jpe?g)$`);
  return filenames.filter((f) => re.test(f)).sort().reverse()[0];
}

export function makeNormalizeAnchorHandlers(deps: NormalizeAnchorRouteDeps): { POST: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json()) as { anchorId?: string };
        if (!body.anchorId) return errorResponse('anchorId required', 400);
        const spec = await deps.specStore.load();
        if (!spec.anchors.find((a) => a.id === body.anchorId)) {
          return errorResponse(`unknown anchorId: ${body.anchorId}`, 400);
        }

        let anchorFiles: string[] = [];
        if (await deps.storage.exists('anchors')) {
          anchorFiles = (await deps.storage.listDir('anchors')).map((f) => f.path.split('/').pop() ?? '');
        }
        const active = findLatestAnchor(anchorFiles, body.anchorId);
        if (!active) return errorResponse('no anchor file to normalize', 404);

        const srcBytes = await deps.storage.readFile(`anchors/${active}`);
        const norm = await normalizeToAspect(srcBytes, deps.aspect);
        if (norm.skipped) {
          return jsonResponse({
            ok: true,
            skipped: 'already at spec aspect',
            dims: { width: norm.inputWidth, height: norm.inputHeight },
          });
        }

        const ts = Date.now();
        const ext = active.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
        const rawName = `${body.anchorId}-original-${ts}.${ext}`;
        const newName = `${body.anchorId}-${ts}.png`;

        await deps.storage.writeFile(`anchors/${rawName}`, srcBytes); // preserve original
        await deps.storage.writeFile(`anchors/${newName}`, norm.bytes); // new normalized

        return jsonResponse({
          ok: true,
          anchorId: body.anchorId,
          previous: active,
          originalSaved: rawName,
          newFilename: newName,
          publicUrl: deps.storage.publicUrl(`anchors/${newName}`),
          inputDims: { width: norm.inputWidth, height: norm.inputHeight },
          outputDims: { width: norm.width, height: norm.height },
        });
      }),
  };
}
