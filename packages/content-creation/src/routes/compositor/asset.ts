/**
 * GET / POST /admin/compositor/asset — list / upload assets.
 * Mirrors RWS baseline: api/admin/compositor/asset/route.ts.
 *
 * Assets are stored under the configured asset prefix (default `assets`).
 * Uploads accept multipart formData with a `file` field. Filename is slugified
 * and namespaced per consumer config.
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';

export interface CompositorAssetRouteDeps extends RouteDeps {
  /** Storage path prefix for assets. Default: 'assets'. */
  assetPrefix?: string;
}

const ASSET_FILENAME_RE = /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov)$/i;

function safeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset';
  return `${base}${ext}`;
}

export function makeCompositorAssetHandlers(deps: CompositorAssetRouteDeps): { GET: RouteHandler; POST: RouteHandler } {
  const prefix = deps.assetPrefix ?? 'assets';
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const fd = await req.formData();
        const file = fd.get('file');
        if (!(file instanceof Blob)) return errorResponse('file required', 400);
        const filename = safeName((file as File).name ?? 'asset');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const storagePath = `${prefix}/${filename}`;
        await deps.storage.writeFile(storagePath, bytes);
        return jsonResponse({
          ok: true,
          filename,
          url: deps.storage.publicUrl(storagePath),
          sizeBytes: bytes.byteLength,
        });
      }),
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        let entries: Awaited<ReturnType<typeof deps.storage.listDir>> = [];
        if (await deps.storage.exists(prefix)) {
          entries = await deps.storage.listDir(prefix);
        }
        const assets = entries
          .filter((entry) => ASSET_FILENAME_RE.test(entry.path.split('/').pop() ?? ''))
          .map((entry) => {
            const fname = entry.path.split('/').pop() ?? entry.path;
            return { filename: fname, url: deps.storage.publicUrl(entry.path) };
          });
        return jsonResponse({ assets });
      }),
  };
}
