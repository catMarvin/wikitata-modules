// Local-dev: accepts a seed image upload and stores it as the latest anchor.
// Auto-normalizes to spec ASPECT (center-crop + resize). Preserves the raw
// upload alongside under a non-matching filename for recovery.
import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { ANCHORS, ASPECT } from '@/lib/bg-spec';
import { uploadAnchorImage } from '@/lib/storage';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const form = await req.formData();
  const anchorId = form.get('anchorId');
  const file = form.get('file');
  if (typeof anchorId !== 'string' || !ANCHORS.find((a) => a.id === anchorId)) {
    return NextResponse.json({ error: 'invalid anchorId' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  const cwd = process.cwd();
  const outDir = path.join(cwd, 'generated', 'anchors');
  await mkdir(outDir, { recursive: true });
  const ext = file.name.toLowerCase().endsWith('.png') ? '.png' : '.jpg';
  const ts = Date.now();
  const filename = `${anchorId}-${ts}${ext}`;
  const rawBuf = Buffer.from(await file.arrayBuffer());

  // Probe input dims, normalize to spec ASPECT (center cover-crop + resize).
  // Preserves the raw upload under a non-matching filename so it stays out of
  // the active-anchor rotation but is recoverable on disk.
  const meta = await sharp(rawBuf).metadata();
  const inW = meta.width ?? 0;
  const inH = meta.height ?? 0;
  const SPEC_RATIO = ASPECT.width / ASPECT.height;
  const inRatio = inW > 0 && inH > 0 ? inW / inH : SPEC_RATIO;
  const mismatch = Math.abs(inRatio - SPEC_RATIO) / SPEC_RATIO > 0.01;
  let writeBuf: Buffer = rawBuf;
  if (mismatch && inW > 0 && inH > 0) {
    // Save raw upload under a non-matching name so the anchor matcher ignores it.
    const rawFilename = `${anchorId}-original-${ts}${ext}`;
    await writeFile(path.join(outDir, rawFilename), rawBuf);
    // Center-crop + resize to spec via cover fit.
    writeBuf = await sharp(rawBuf)
      .resize(ASPECT.width, ASPECT.height, { fit: 'cover', position: 'attention' })
      .toFormat(ext === '.png' ? 'png' : 'jpeg')
      .toBuffer();
  }

  await writeFile(path.join(outDir, filename), writeBuf);
  let storagePublicUrl: string | null = null;
  try {
    const up = await uploadAnchorImage(supabase, filename, writeBuf);
    storagePublicUrl = up.publicUrl;
  } catch (e) {
    console.warn('[upload] storage upload failed:', e);
  }
  return NextResponse.json({
    ok: true,
    anchorId,
    filename,
    storageUrl: storagePublicUrl,
    normalized: mismatch,
    inputDims: inW && inH ? { w: inW, h: inH } : null,
    outputDims: { w: ASPECT.width, h: ASPECT.height },
  });
}
