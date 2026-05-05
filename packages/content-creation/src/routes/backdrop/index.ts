/**
 * Backdrop route factory — mounts all api/admin/gen/* handlers from a single
 * call site so consumers can wire them into their framework's router.
 *
 * v0.2.0-step4b ships: models, balance, file. Remaining (spec, state, anchor,
 * video, stitch, reassess, upload, archive, log, batch-log, normalize-anchor,
 * backfill-anchors, promote-lab, transform-image, write-project) land in
 * subsequent v0.2.0-step4* commits.
 */

import type { RouteDeps, RouteHandler } from '../types.js';
import { makeModelsHandlers } from './models.js';
import { makeBalanceHandlers } from './balance.js';
import { makeFileHandlers } from './file.js';
import { makeSpecHandlers, type SpecRouteDeps } from './spec.js';
import { makeSpecInsertHandlers, makeSpecDeleteHandlers } from './spec-mutate.js';
import { makeStateHandlers } from './state.js';

export interface BackdropRoutes {
  models: { GET: RouteHandler };
  balance: { GET: RouteHandler };
  file: { GET: RouteHandler };
  spec: { GET: RouteHandler; POST: RouteHandler };
  specInsert: { POST: RouteHandler };
  specDelete: { POST: RouteHandler };
  state: { GET: RouteHandler };
  // Subsequent steps will add: anchor, video, stitch, reassess,
  // upload, archive, log, batchLog, normalizeAnchor, backfillAnchors,
  // promoteLab, transformImage, writeProject.
}

export interface CreateBackdropRoutesDeps extends RouteDeps {
  /** Required for spec/state/insert/delete handlers (introduced in step4c). */
  specStore: SpecRouteDeps['specStore'];
}

export function createBackdropRoutes(deps: CreateBackdropRoutesDeps): BackdropRoutes {
  const specDeps: SpecRouteDeps = deps;
  return {
    models: makeModelsHandlers(deps),
    balance: makeBalanceHandlers(deps),
    file: makeFileHandlers(deps),
    spec: makeSpecHandlers(specDeps),
    specInsert: makeSpecInsertHandlers(specDeps),
    specDelete: makeSpecDeleteHandlers(specDeps),
    state: makeStateHandlers(specDeps),
  };
}
