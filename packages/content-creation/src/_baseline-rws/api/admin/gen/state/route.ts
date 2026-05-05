// Local-dev: returns latest anchor/segment files in generated/.
import { NextResponse } from 'next/server';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { loadSpec } from '@/lib/spec-store';

/**
 * Reads pixel dimensions from a PNG/JPEG header. Reads only the first 24 bytes
 * for PNG and up to 64KB for JPEG SOF marker scan. Returns null on parse failure
 * (callers tolerate undefined dims; UI just hides the badge).
 */
async function readImageDims(absPath: string): Promise<{ width: number; height: number } | null> {
  try {
    const fh = await open(absPath, 'r');
    try {
      const head = Buffer.alloc(24);
      const { bytesRead } = await fh.read(head, 0, 24, 0);
      if (bytesRead < 24) return null;
      // PNG: signature 0x89 50 4E 47 0D 0A 1A 0A, IHDR at bytes 16-23 (width then height, big-endian uint32).
      if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
      }
      // JPEG: starts with FF D8. Scan for SOF0/2 markers (FF C0 / FF C2) — height then width are 16-bit BE
      // at marker_offset+5 and +7. Read up to 64KB to find the first SOF.
      if (head[0] === 0xff && head[1] === 0xd8) {
        const big = Buffer.alloc(65536);
        const { bytesRead: br } = await fh.read(big, 0, 65536, 0);
        for (let i = 2; i < br - 9; i++) {
          if (big[i] === 0xff && (big[i + 1] === 0xc0 || big[i + 1] === 0xc2)) {
            return { width: big.readUInt16BE(i + 7), height: big.readUInt16BE(i + 5) };
          }
        }
      }
      return null;
    } finally {
      await fh.close();
    }
  } catch { return null; }
}

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

export async function GET() {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const cwd = process.cwd();
  const anchorsDir = path.join(cwd, 'generated', 'anchors');
  const segmentsDir = path.join(cwd, 'generated', 'segments');
  const labDir = path.join(cwd, 'generated', 'lab');

  const safeRead = async (dir: string) => {
    try { return await readdir(dir); } catch { return []; }
  };

  const anchorFiles = await safeRead(anchorsDir);
  const segmentFiles = await safeRead(segmentsDir);
  const labFiles = await safeRead(labDir);
  const spec = await loadSpec();

  // Image-Lab variants (img2img scratchpad). Newest first.
  const labRe = /^lab-([a-zA-Z0-9_-]+)-(\d+)-(\d+)\.png$/;
  const lab = labFiles
    .map((f) => {
      const m = f.match(labRe);
      if (!m) return null;
      return { filename: f, sourceTag: m[1], ts: Number(m[2]), variant: Number(m[3]) };
    })
    .filter((x): x is { filename: string; sourceTag: string; ts: number; variant: number } => !!x)
    .sort((a, b) => b.ts - a.ts || a.variant - b.variant);

  // Pull archived segment filenames for the current composition so they're
  // hidden from the per-tile history rotation.
  const { data: archiveRows } = await supabase
    .from('hero_segment_archive')
    .select('filename, slot, archived_at, notes')
    .eq('organization', 'readings-with-scot')
    .eq('project', 'rws')
    .eq('composition', 'home-hero')
    .order('archived_at', { ascending: false });
  const archivedSet = new Set((archiveRows ?? []).map((r) => r.filename as string));
  const archive = (archiveRows ?? []).map((r) => ({
    filename: r.filename as string,
    slot: r.slot as string,
    archived_at: r.archived_at as string,
    notes: (r.notes as string | null) ?? null,
  }));

  const anchors: Record<string, string> = {};
  const anchorHistory: Record<string, string[]> = {};
  const anchorDims: Record<string, { w: number; h: number }> = {};
  // Anchor file naming: `${id}-<unix-ms>.<png|jpg|jpeg>`. Use a regex anchored at
  // the timestamp so an id that's a prefix of another id (e.g. `haze` vs
  // `haze-bridge`) doesn't claim the longer id's files.
  function matcher(id: string): RegExp {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${esc}-\\d+\\.(png|jpe?g)$`);
  }
  for (const a of spec.anchors) {
    const re = matcher(a.id);
    const matches = anchorFiles.filter((f) => re.test(f)).sort();
    if (matches.length) {
      const active = matches[matches.length - 1];
      anchors[a.id] = active;
      anchorHistory[a.id] = matches.slice().reverse();
      const dims = await readImageDims(path.join(anchorsDir, active));
      if (dims) anchorDims[a.id] = { w: dims.width, h: dims.height };
    }
  }

  // Segments are keyed by `${startAnchor}__${endAnchor}` slot. Also surface
  // legacy numeric-keyed `seg-1-…` files so older renders stay visible.
  const segments: Record<string, string> = {};
  const segmentHistory: Record<string, string[]> = {};
  function segMatcher(prefix: string): RegExp {
    const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^seg-${esc}-\\d+\\.(mp4|webm|mov)$`);
  }
  for (let i = 0; i < spec.segments.length; i++) {
    const s = spec.segments[i];
    const slotKey = `${s.startAnchor}__${s.endAnchor}`;
    const slotRe = segMatcher(slotKey);
    const legacyRe = segMatcher(String(i + 1));
    const slotMatches = segmentFiles.filter((f) => slotRe.test(f) && !archivedSet.has(f)).sort();
    const legacyMatches = segmentFiles.filter((f) => legacyRe.test(f) && !archivedSet.has(f)).sort();
    const matches = [...legacyMatches, ...slotMatches];
    if (matches.length) {
      segments[slotKey] = matches[matches.length - 1];
      segmentHistory[slotKey] = matches.slice().reverse();
    }
  }

  return NextResponse.json({ anchors, segments, anchorHistory, segmentHistory, anchorDims, archive, lab, spec });
}
