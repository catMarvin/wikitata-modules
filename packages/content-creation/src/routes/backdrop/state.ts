/**
 * GET /admin/gen/state — aggregate editor state: spec + per-anchor file
 * presence + per-segment file presence + history.
 *
 * Mirrors RWS baseline: api/admin/gen/state/route.ts (140 LOC). The package
 * version reads file presence via StorageAdapter.listDir() rather than direct
 * fs calls.
 */

import { jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { SpecRouteDeps } from './spec.js';

interface AnchorFile {
  filename: string;
  ts: number;
  size: number;
  publicUrl: string;
}

interface SegmentFile {
  filename: string;
  ts: number;
  size: number;
  publicUrl: string;
}

interface AnchorState {
  id: string;
  files: AnchorFile[]; // newest first
}

interface SegmentState {
  startAnchor: string;
  endAnchor: string;
  files: SegmentFile[];
}

const ANCHOR_DIR = 'anchors';
const SEGMENT_DIR = 'segments';

function tsFromName(name: string): number {
  // Filename pattern: "<anchorId>-<digits>.<ext>" (per S180 prefix-bug fix anchored regex).
  const m = name.match(/-(\d{10,})\.[a-z0-9]+$/i);
  return m ? parseInt(m[1]!, 10) : 0;
}

export function makeStateHandlers(deps: SpecRouteDeps): { GET: RouteHandler } {
  return {
    GET: (req) =>
      withAdmin(req, deps.auth, async () => {
        const spec = await deps.specStore.load();

        // List anchors directory (may not exist yet).
        let anchorEntries: Awaited<ReturnType<typeof deps.storage.listDir>> = [];
        if (await deps.storage.exists(ANCHOR_DIR)) {
          anchorEntries = await deps.storage.listDir(ANCHOR_DIR);
        }

        let segmentEntries: typeof anchorEntries = [];
        if (await deps.storage.exists(SEGMENT_DIR)) {
          segmentEntries = await deps.storage.listDir(SEGMENT_DIR);
        }

        // Group anchor files by anchor id (matching the file name prefix exactly).
        const anchorState: AnchorState[] = spec.anchors.map((a) => {
          const re = new RegExp(`^${a.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{10,})\\.`);
          const matched = anchorEntries
            .filter((entry) => re.test(entry.path.split('/').pop() ?? ''))
            .map<AnchorFile>((entry) => ({
              filename: entry.path.split('/').pop() ?? entry.path,
              ts: tsFromName(entry.path),
              size: entry.size,
              publicUrl: deps.storage.publicUrl(entry.path),
            }))
            .sort((x, y) => y.ts - x.ts);
          return { id: a.id, files: matched };
        });

        // Group segment files by ordered pair: "<startId>__<endId>-<ts>.mp4".
        const segmentState: SegmentState[] = spec.segments.map((s) => {
          const key = `${s.startAnchor}__${s.endAnchor}`;
          const re = new RegExp(
            `^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{10,})\\.`,
          );
          const matched = segmentEntries
            .filter((entry) => re.test(entry.path.split('/').pop() ?? ''))
            .map<SegmentFile>((entry) => ({
              filename: entry.path.split('/').pop() ?? entry.path,
              ts: tsFromName(entry.path),
              size: entry.size,
              publicUrl: deps.storage.publicUrl(entry.path),
            }))
            .sort((x, y) => y.ts - x.ts);
          return { startAnchor: s.startAnchor, endAnchor: s.endAnchor, files: matched };
        });

        return jsonResponse({ ok: true, spec, anchorState, segmentState });
      }),
  };
}
