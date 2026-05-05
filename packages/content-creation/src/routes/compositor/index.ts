/**
 * Compositor route factory.
 *
 * v0.2.0 ships: list, asset (GET/POST), byId (GET/POST/DELETE).
 * Deferred to v0.2.1: bake (Playwright + ffmpeg adapter — heavy peer deps).
 */

import type { RouteDeps, RouteHandler } from '../types.js';
import { makeCompositorListHandlers, type CompositorListRouteDeps } from './list.js';
import {
  makeCompositorByIdHandlers,
  type CompositorByIdRouteDeps,
  type CompositorByIdHandlers,
} from './by-id.js';
import { makeCompositorAssetHandlers, type CompositorAssetRouteDeps } from './asset.js';

export interface CompositorRoutes {
  list: { GET: RouteHandler };
  byId: CompositorByIdHandlers;
  asset: { GET: RouteHandler; POST: RouteHandler };
  // Deferred v0.2.1: bake (PlaywrightFfmpegBakeAdapter).
}

export interface CreateCompositorRoutesDeps extends RouteDeps {
  compositionStore: CompositorListRouteDeps['compositionStore'];
  /** Storage prefix for asset uploads. Default 'assets'. */
  assetPrefix?: string;
}

export function createCompositorRoutes(deps: CreateCompositorRoutesDeps): CompositorRoutes {
  const listDeps: CompositorListRouteDeps = deps;
  const byIdDeps: CompositorByIdRouteDeps = deps;
  const assetDeps: CompositorAssetRouteDeps = deps;
  return {
    list: makeCompositorListHandlers(listDeps),
    byId: makeCompositorByIdHandlers(byIdDeps),
    asset: makeCompositorAssetHandlers(assetDeps),
  };
}
