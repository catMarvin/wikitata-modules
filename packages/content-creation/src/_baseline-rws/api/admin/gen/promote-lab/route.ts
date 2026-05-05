// Promote a lab variant into an anchor slot — copies generated/lab/<file>
// to generated/anchors/<anchorId>-<ts>.png so the anchor matcher picks it up.
import { NextResponse } from 'next/server';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { ANCHORS } from '@/lib/bg-spec';
import { uploadAnchorImage } from '@/lib/storage';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json()) as { labFilename?: string; anchorId?: string };
  if (!body.labFilename || !body.anchorId) {
    return NextResponse.json({ error: 'labFilename + anchorId required' }, { status: 400 });
  }
  if (!ANCHORS.find((a) => a.id === body.anchorId)) {
    return NextResponse.json({ error: 'unknown anchorId' }, { status: 400 });
  }

  const cwd = process.cwd();
  const labDir = path.join(cwd, 'generated', 'lab');
  const anchorsDir = path.join(cwd, 'generated', 'anchors');
  await mkdir(anchorsDir, { recursive: true });

  const srcAbs = path.resolve(labDir, path.basename(body.labFilename));
  const ts = Date.now();
  const filename = `${body.anchorId}-${ts}.png`;
  const destAbs = path.join(anchorsDir, filename);
  await copyFile(srcAbs, destAbs);

  let storagePublicUrl: string | null = null;
  try {
    const buf = await readFile(destAbs);
    const up = await uploadAnchorImage(supabase, filename, buf);
    storagePublicUrl = up.publicUrl;
  } catch (e) {
    console.warn('[promote-lab] storage upload failed:', e);
  }
  return NextResponse.json({ ok: true, anchorId: body.anchorId, filename, storageUrl: storagePublicUrl });
}
