/**
 * GET / POST /admin/gen/batch-log — bulk-render summary rows.
 * Mirrors RWS baseline: api/admin/gen/batch-log/route.ts.
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { BatchSpendLogStore } from '../../persistence/cost-log.js';

export interface BatchSpendRouteDeps extends RouteDeps {
  batchSpendLog: BatchSpendLogStore;
}

export function makeBatchLogHandlers(deps: BatchSpendRouteDeps): { GET: RouteHandler; POST: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json().catch(() => ({}))) as {
          segIndices?: number[]; segLabels?: string[];
          okCount?: number; errCount?: number;
          costMeasured?: number | null; costEstimate?: number;
          balanceBefore?: number | null; balanceAfter?: number | null;
          model?: string; ts?: number;
        };
        if (!Array.isArray(body.segIndices) || !Array.isArray(body.segLabels)) {
          return errorResponse('segIndices + segLabels required', 400);
        }
        await deps.batchSpendLog.append({
          segIndices: body.segIndices,
          segLabels: body.segLabels,
          okCount: body.okCount,
          errCount: body.errCount,
          costMeasured: body.costMeasured,
          costEstimate: body.costEstimate,
          balanceBefore: body.balanceBefore,
          balanceAfter: body.balanceAfter,
          model: body.model,
          ts: body.ts,
        });
        return jsonResponse({ ok: true });
      }),
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        const entries = await deps.batchSpendLog.list(50);
        return jsonResponse({ entries });
      }),
  };
}
