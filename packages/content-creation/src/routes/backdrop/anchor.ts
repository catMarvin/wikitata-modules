/**
 * POST /admin/gen/anchor — generate (or regenerate) an anchor image via AIAdapter.
 * Mirrors RWS baseline: api/admin/gen/anchor/route.ts.
 *
 * Behavior:
 *   1. Resolve anchor by id from spec
 *   2. Call ai.generateImage({model, prompt, size}) — captures cost from header
 *   3. Materialize image bytes (b64 inline OR fetch from returned URL)
 *   4. Write to storage at `anchors/<id>-<ts>.png`
 *   5. Append cost log row
 *   6. Return ok envelope with publicUrl + cost
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { CostLogStore } from '../../persistence/cost-log.js';
import type { SpecStore } from '../../persistence/spec-store.js';
import { COST_PER } from '../../lib/cost-constants.js';

export interface AnchorRouteDeps extends RouteDeps {
  specStore: SpecStore;
  costLog: CostLogStore;
  /** AI model slug for image gen, e.g. "bfl/flux-pro-1.1-ultra". */
  imageModel: string;
  /** Output canvas dims, e.g. {width: 1920, height: 1080}. */
  aspect: { width: number; height: number };
  /** Project tag for cost log rows. */
  project?: string;
}

export function makeAnchorHandlers(deps: AnchorRouteDeps): { POST: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json()) as { anchorId?: string; promptOverride?: string };
        const spec = await deps.specStore.load();
        const anchor = spec.anchors.find((a) => a.id === body.anchorId);
        if (!anchor) return errorResponse('unknown anchorId', 400);

        const prompt = body.promptOverride ?? anchor.prompt;

        let measured;
        try {
          measured = await deps.ai.generateImage({
            model: deps.imageModel,
            prompt,
            size: `${deps.aspect.width}x${deps.aspect.height}`,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await deps.costLog.append({
            msg: `✗ anchor ${anchor.id}: ${errMsg}`,
            ok: false,
            cost_usd: 0,
            model: deps.imageModel,
            cost_source: 'estimate',
            project: deps.project,
            route: 'gateway',
            provider: 'bfl',
            native_unit: 'usd',
            native_amount: 0,
          });
          return errorResponse(errMsg, 500);
        }

        const result = measured.result;

        let imageBuf: Uint8Array;
        if (result.b64_json) {
          // base64 → bytes
          const binary = typeof atob === 'function'
            ? atob(result.b64_json)
            : Buffer.from(result.b64_json, 'base64').toString('binary');
          imageBuf = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) imageBuf[i] = binary.charCodeAt(i);
        } else if (result.url) {
          const r = await fetch(result.url);
          if (!r.ok) return errorResponse(`fetch image url failed: ${r.status}`, 502);
          imageBuf = new Uint8Array(await r.arrayBuffer());
        } else {
          return errorResponse('no image data returned', 500);
        }

        const ts = Date.now();
        const filename = `${anchor.id}-${ts}.png`;
        const storagePath = `anchors/${filename}`;
        await deps.storage.writeFile(storagePath, imageBuf);
        const publicUrl = deps.storage.publicUrl(storagePath);

        const cost = measured.costUsd ?? COST_PER.flux;
        const costSource = measured.costUsd != null ? 'measured' : 'estimate';
        await deps.costLog.append({
          msg: `flux anchor → ${anchor.id}`,
          ok: true,
          cost_usd: cost,
          model: deps.imageModel,
          cost_source: costSource as 'measured' | 'estimate',
          project: deps.project,
          route: 'gateway',
          provider: 'bfl',
          native_unit: 'usd',
          native_amount: cost,
        });

        return jsonResponse({
          ok: true,
          anchorId: anchor.id,
          filename,
          storagePath,
          publicUrl,
          cost_usd: cost,
          cost_source: costSource,
          cost_estimate: COST_PER.flux,
        });
      }),
  };
}
