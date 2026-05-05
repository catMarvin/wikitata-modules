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

export interface BackdropRoutes {
  models: { GET: RouteHandler };
  balance: { GET: RouteHandler };
  file: { GET: RouteHandler };
  // Subsequent steps will add: spec, state, anchor, video, stitch, reassess,
  // upload, archive, log, batchLog, normalizeAnchor, backfillAnchors,
  // promoteLab, transformImage, writeProject.
}

export function createBackdropRoutes(deps: RouteDeps): BackdropRoutes {
  return {
    models: makeModelsHandlers(deps),
    balance: makeBalanceHandlers(deps),
    file: makeFileHandlers(deps),
  };
}
