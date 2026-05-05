// Local-dev: re-normalize an existing anchor file (center-crop + resize to spec).
// Reads the latest file for the anchor, writes a new normalized version with
// a fresh timestamp, preserves original under -original- naming.
import { NextResponse } from 'next/server';
import { readFile, writeFile, readdir } from 'node:fs/promises';
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
  const body = (await req.json()) as { anchorId?: string };
  if (!body.anchorId || !ANCHORS.find((a) => a.id === body.anchorId)) {
    return NextResponse.json({ error: 'invalid anchorId' }, { status: 400 });
  }

  const cwd = process.cwd();
  const anchorsDir = path.join(cwd, 'generated', 'anchors');
  const all = await readdir(anchorsDir).catch(() => []);
  const re = new RegExp(`^${body.anchorId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}-\\d+\\.(png|jpe?g)$`);
  const matches = all.filter((f) => re.test(f)).sort();
  if (!matches.length) {
    return NextResponse.json({ error: 'no anchor file to normalize' }, { status: 404 });
  }
  const active = matches[matches.length - 1];
  const ext = active.toLowerCase().endsWith('.png') ? '.png' : '.jpg';
  const srcBuf = await readFile(path.join(anchorsDir, active));
  const meta = await sharp(srcBuf).metadata();
  const inW = meta.width ?? 0;
  const inH = meta.height ?? 0;
  const SPEC_RATIO = ASPECT.width / ASPECT.height;
  const inRatio = inW > 0 && inH > 0 ? inW / inH : SPEC_RATIO;
  const mismatch = Math.abs(inRatio - SPEC_RATIO) / SPEC_RATIO > 0.01;
  if (!mismatch) {
    return NextResponse.json({ ok: true, skipped: 'already at spec aspect', dims: { w: inW, h: inH } });
  }

  const ts = Date.now();
  const rawFilename = `${body.anchorId}-original-${ts}${ext}`;
  const newFilename = `${body.anchorId}-${ts}${ext}`;
  await writeFile(path.join(anchorsDir, rawFilename), srcBuf);
  const outBuf = await sharp(srcBuf)
    .resize(ASPECT.width, ASPECT.height, { fit: 'cover', position: 'attention' })
    .toFormat(ext === '.png' ? 'png' : 'jpeg')
    .toBuffer();
  await writeFile(path.join(anchorsDir, newFilename), outBuf);
  let storagePublicUrl: string | null = null;
  try {
    const up = await uploadAnchorImage(supabase, newFilename, outBuf);
    storagePublicUrl = up.publicUrl;
  } catch (e) {
    console.warn('[normalize-anchor] storage upload failed:', e);
  }
  return NextResponse.json({
    ok: true,
    anchorId: body.anchorId,
    filename: newFilename,
    storageUrl: storagePublicUrl,
    inputDims: { w: inW, h: inH },
    outputDims: { w: ASPECT.width, h: ASPECT.height },
    rawPreservedAs: rawFilename,
  });
}
