/**
 * GET /admin/gen/log + POST + PATCH (archive_visible).
 * Mirrors RWS baseline: api/admin/gen/log/route.ts.
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { GenLogStore } from '../../persistence/cost-log.js';

export interface GenLogRouteDeps extends RouteDeps {
  genLog: GenLogStore;
}

export function makeGenLogHandlers(deps: GenLogRouteDeps): { GET: RouteHandler; POST: RouteHandler; PATCH: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json().catch(() => ({}))) as { msg?: string; ok?: boolean; sessionId?: string; ts?: number };
        if (!body.msg || typeof body.msg !== 'string') return errorResponse('msg required', 400);
        await deps.genLog.append({ msg: body.msg, ok: body.ok, sessionId: body.sessionId, ts: body.ts });
        return jsonResponse({ ok: true });
      }),
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        const url = new URL(req.url);
        const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') ?? '500')));
        const showArchived = url.searchParams.get('showArchived') === '1';
        const entries = await deps.genLog.list({ limit, showArchived });
        return jsonResponse({ entries });
      }),
    PATCH: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json().catch(() => ({}))) as { action?: 'archive_visible'; before?: number };
        if (body.action !== 'archive_visible') return errorResponse('unknown action', 400);
        const beforeIso = body.before ? new Date(body.before).toISOString() : new Date().toISOString();
        const result = await deps.genLog.archiveBefore(beforeIso);
        return jsonResponse({ ok: true, archivedCount: result.archivedCount });
      }),
  };
}
