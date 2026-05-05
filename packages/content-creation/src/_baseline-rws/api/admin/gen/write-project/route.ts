// Local-dev-only: snapshots ./generated/* (anchors, segments, loop, spec.json) into the
// RWS Supabase project — uploads files to private storage bucket "hero-renders" under
// `snapshots/<iso-ts>/` and inserts manifest rows into public.hero_renders.
//
// Uses service-role key (server-side only, gated by VERCEL env check) to bypass RLS.
// "Write project" wrap action: nothing in generated/ is ever lost when the local FS
// is wiped or the machine changes.
import { NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { loadSpec } from '@/lib/spec-store';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.RWS_SUPABASE_SERVICE_ROLE_KEY ?? '';

type Body = {
  anchorOverride?: Record<string, string>;
  segmentOverride?: Record<string, string>;
  stitchedFile?: string | null;
};

export async function POST(req: Request) {
  assertLocal();
  if (!SERVICE_ROLE) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not configured. Inject from vault before write-project.' },
      { status: 500 },
    );
  }

  // Auth gate: must be signed-in admin in browser, then route uses service-role for DB writes.
  const supaUser = await getSupabaseServer();
  const { data: { user } } = await supaUser.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const spec = await loadSpec();
  const cwd = process.cwd();
  const anchorsDir = path.join(cwd, 'generated', 'anchors');
  const segmentsDir = path.join(cwd, 'generated', 'segments');
  const loopDir = path.join(cwd, 'generated');

  const safeRead = async (dir: string) => {
    try { return await readdir(dir); } catch { return []; }
  };

  const anchorFiles = await safeRead(anchorsDir);
  const segmentFiles = await safeRead(segmentsDir);
  const loopRoot = (await safeRead(loopDir)).filter((f) => /^loop-\d+(-mobile)?\.(mp4|jpg)$/.test(f));

  const snapshotId = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `snapshots/${snapshotId}`;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let uploaded = 0;
  let bytes = 0;
  const uploadErrors: string[] = [];

  async function uploadFile(absPath: string, key: string, contentType: string) {
    const buf = await readFile(absPath);
    bytes += buf.byteLength;
    const { error } = await admin.storage.from('hero-renders').upload(key, buf, {
      contentType, upsert: true,
    });
    if (error) { uploadErrors.push(`${key}: ${error.message}`); return false; }
    uploaded += 1;
    return true;
  }

  // 1) anchors
  for (const f of anchorFiles) {
    const ext = path.extname(f).toLowerCase();
    const ct = ext === '.png' ? 'image/png' : 'image/jpeg';
    await uploadFile(path.join(anchorsDir, f), `${prefix}/anchors/${f}`, ct);
  }
  // 2) segments
  for (const f of segmentFiles) {
    await uploadFile(path.join(segmentsDir, f), `${prefix}/segments/${f}`, 'video/mp4');
  }
  // 3) loop outputs
  for (const f of loopRoot) {
    const ct = f.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4';
    await uploadFile(path.join(loopDir, f), `${prefix}/loop/${f}`, ct);
  }
  // 4) spec.json (always include)
  const specPath = path.join(loopDir, 'spec.json');
  try {
    await stat(specPath);
    await uploadFile(specPath, `${prefix}/spec.json`, 'application/json');
  } catch { /* spec.json absent is fine */ }

  // 5) Manifest rows for segment renders (history + active flag from client overrides)
  type RenderRow = {
    segment_index: number;
    prompt_used: string;
    mode: 'std' | 'pro';
    duration_s: number;
    cost_usd: number | null;
    status: 'done';
    blob_path: string;
    is_active: boolean;
    created_at: string;
    completed_at: string;
  };
  const RATE = { std: 0.042, pro: 0.07 } as const;
  const slotMatcher = (slotKey: string) => {
    const esc = slotKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^seg-${esc}-(\\d+)\\.(mp4|webm|mov)$`);
  };

  const rows: RenderRow[] = [];
  for (let i = 0; i < spec.segments.length; i++) {
    const s = spec.segments[i];
    const slotKey = `${s.startAnchor}__${s.endAnchor}`;
    const re = slotMatcher(slotKey);
    const matches = segmentFiles.filter((f) => re.test(f)).sort();
    if (!matches.length) continue;
    const overrideFile = body.segmentOverride?.[slotKey];
    const activeFile = overrideFile && matches.includes(overrideFile) ? overrideFile : matches[matches.length - 1];
    for (const f of matches) {
      const tsMatch = f.match(re);
      const ts = tsMatch ? Number(tsMatch[1]) : Date.now();
      const mode = (s.mode ?? 'std') as 'std' | 'pro';
      rows.push({
        segment_index: i + 1,
        prompt_used: s.prompt,
        mode,
        duration_s: s.duration,
        cost_usd: s.duration * RATE[mode],
        status: 'done',
        blob_path: `${prefix}/segments/${f}`,
        is_active: f === activeFile,
        created_at: new Date(ts).toISOString(),
        completed_at: new Date(ts).toISOString(),
      });
    }
  }

  let manifestRows = 0;
  if (rows.length) {
    const { error: insErr, count } = await admin.from('hero_renders').insert(rows, { count: 'exact' });
    if (insErr) {
      return NextResponse.json({
        error: `manifest insert failed: ${insErr.message}`,
        uploaded, bytes, uploadErrors, snapshotId,
      }, { status: 500 });
    }
    manifestRows = count ?? rows.length;
  }

  return NextResponse.json({
    ok: true,
    snapshotId,
    uploaded,
    bytes,
    manifestRows,
    uploadErrors: uploadErrors.length ? uploadErrors : undefined,
  });
}
