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
import { makeGenLogHandlers, type GenLogRouteDeps } from './log.js';
import { makeBatchLogHandlers, type BatchSpendRouteDeps } from './batch-log.js';
import { makeAnchorHandlers, type AnchorRouteDeps } from './anchor.js';
import { makeReassessHandlers, type ReassessRouteDeps } from './reassess.js';

export interface BackdropRoutes {
  models: { GET: RouteHandler };
  balance: { GET: RouteHandler };
  file: { GET: RouteHandler };
  spec: { GET: RouteHandler; POST: RouteHandler };
  specInsert: { POST: RouteHandler };
  specDelete: { POST: RouteHandler };
  state: { GET: RouteHandler };
  log: { GET: RouteHandler; POST: RouteHandler; PATCH: RouteHandler };
  batchLog: { GET: RouteHandler; POST: RouteHandler };
  anchor: { POST: RouteHandler };
  reassess: { POST: RouteHandler };
  // Subsequent steps add: video, stitch, upload, archive, normalizeAnchor,
  // backfillAnchors, promoteLab, transformImage, writeProject.
}

export interface CreateBackdropRoutesDeps extends RouteDeps {
  specStore: SpecRouteDeps['specStore'];
  genLog: GenLogRouteDeps['genLog'];
  batchSpendLog: BatchSpendRouteDeps['batchSpendLog'];
  costLog: AnchorRouteDeps['costLog'];
  imageModel: AnchorRouteDeps['imageModel'];
  aspect: AnchorRouteDeps['aspect'];
  chatModel: ReassessRouteDeps['chatModel'];
  project?: string;
}

export function createBackdropRoutes(deps: CreateBackdropRoutesDeps): BackdropRoutes {
  const specDeps: SpecRouteDeps = deps;
  const genLogDeps: GenLogRouteDeps = deps;
  const batchDeps: BatchSpendRouteDeps = deps;
  const anchorDeps: AnchorRouteDeps = deps;
  const reassessDeps: ReassessRouteDeps = deps;
  return {
    models: makeModelsHandlers(deps),
    balance: makeBalanceHandlers(deps),
    file: makeFileHandlers(deps),
    spec: makeSpecHandlers(specDeps),
    specInsert: makeSpecInsertHandlers(specDeps),
    specDelete: makeSpecDeleteHandlers(specDeps),
    state: makeStateHandlers(specDeps),
    log: makeGenLogHandlers(genLogDeps),
    batchLog: makeBatchLogHandlers(batchDeps),
    anchor: makeAnchorHandlers(anchorDeps),
    reassess: makeReassessHandlers(reassessDeps),
  };
}
