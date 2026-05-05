/**
 * Framework-neutral route handler types.
 *
 * Every handler emitted by `createBackdropRoutes()` and `createCompositorRoutes()`
 * is a Web-standard `(req: Request) => Promise<Response>` function. Consumer
 * frameworks wrap as needed:
 *
 *   Next.js App Router:
 *     export const POST = routes.anchor.POST;
 *
 *   Hono:
 *     app.post('/api/cc/anchor', (c) => routes.anchor.POST(c.req.raw));
 *
 *   Express (via @whatwg-node/server or similar shim):
 *     app.post('/api/cc/anchor', toExpressMiddleware(routes.anchor.POST));
 *
 *   Plain Node http:
 *     wrap with @whatwg-node/node-fetch / std/http adapters.
 */

import type { AIAdapter } from '../adapters/ai.js';
import type { StorageAdapter } from '../adapters/storage.js';

/** Web-standard handler. */
export type RouteHandler = (req: Request) => Promise<Response>;

/** Auth gate — consumer-supplied. Throws or rejects to deny. Returns the authed user payload to allow. */
export interface AuthAdapter {
  /** Resolves an admin user record, or throws/rejects to deny. */
  requireAdmin(req: Request): Promise<{ id: string; email?: string; [k: string]: unknown }>;
}

/** Environment / runtime fence. */
export interface EnvAdapter {
  /** True when the consumer wants to refuse running on serverless platforms (RWS hero-bg pattern). */
  isLocalOnlyAllowed(): boolean;
  /** Returns environment values the routes may need (model slugs, aspect, etc.). */
  get(name: string): string | undefined;
}

/** Bundle of dependencies passed to every route factory. */
export interface RouteDeps {
  storage: StorageAdapter;
  ai: AIAdapter;
  auth: AuthAdapter;
  env: EnvAdapter;
}

/** JSON helper — consistent error shape across handlers. */
export function jsonResponse(payload: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  });
}

/** Standard error envelope. */
export function errorResponse(message: string, status = 500, extra?: Record<string, unknown>): Response {
  return jsonResponse({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

/** Run an admin-gated handler with consistent error mapping. */
export async function withAdmin(
  req: Request,
  auth: AuthAdapter,
  inner: (user: Awaited<ReturnType<AuthAdapter['requireAdmin']>>) => Promise<Response>,
): Promise<Response> {
  let user;
  try {
    user = await auth.requireAdmin(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'forbidden';
    return errorResponse(msg, 403);
  }
  try {
    return await inner(user);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
}
