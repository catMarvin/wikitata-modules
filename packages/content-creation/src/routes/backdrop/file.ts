/**
 * GET /admin/gen/file?kind=anchor|segment|stitch&path=... — stream a generated file.
 * Mirrors RWS baseline: api/admin/gen/file/route.ts.
 *
 * The baseline served files from local disk under ./generated/. The genericized
 * handler reads from the configured StorageAdapter — same paths, different backend.
 */

import { errorResponse, withAdmin, type RouteDeps, type RouteHandler } from '../types.js';

const ALLOWED_KINDS = new Set(['anchor', 'segment', 'stitch', 'asset']);

function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'json': return 'application/json';
    default: return 'application/octet-stream';
  }
}

export function makeFileHandlers(deps: RouteDeps): { GET: RouteHandler } {
  return {
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        const url = new URL(req.url);
        const kind = url.searchParams.get('kind') ?? '';
        const subpath = url.searchParams.get('path') ?? '';
        if (!ALLOWED_KINDS.has(kind)) return errorResponse(`bad kind: ${kind}`, 400);
        if (!subpath) return errorResponse('path required', 400);

        const fullPath = `${kind}s/${subpath}`;
        try {
          const bytes = await deps.storage.readFile(fullPath);
          // Use a fresh ArrayBuffer slice to avoid SharedArrayBuffer issues
          // in environments where Uint8Array.buffer might be shared.
          const ab = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(ab).set(bytes);
          return new Response(ab, {
            status: 200,
            headers: {
              'content-type': guessContentType(subpath),
              'cache-control': 'no-store',
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return errorResponse(`file read failed: ${msg}`, 404);
        }
      }),
  };
}
