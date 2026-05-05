// Image Lab — img2img transform via fal.ai kontext. Saves N normalized variants
// to generated/lab/ with provenance metadata, logs spend with composition='image-lab'.
import { NextResponse } from 'next/server';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { ASPECT } from '@/lib/bg-spec';
import { transformImageViaFal } from '@/lib/fal';
import { logCost } from '@/lib/cost-log';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

// fal kontext is per-call; estimate from observed pricing (~$0.04 per img).
const KONTEXT_USD_PER_IMAGE = 0.04;

export const maxDuration = 600;

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json()) as {
    sourceFilename?: string;       // existing anchor file in generated/anchors/
    prompt?: string;
    n?: number;
    slug?: string;                 // fal model slug (default kontext)
    sourceTag?: string;            // free-text tag for the result filename
  };
  if (!body.sourceFilename || !body.prompt) {
    return NextResponse.json({ error: 'sourceFilename + prompt required' }, { status: 400 });
  }
  const slug = body.slug || 'fal-ai/flux-pro/kontext';
  const n = Math.max(1, Math.min(body.n ?? 1, 4));

  const cwd = process.cwd();
  const anchorsDir = path.join(cwd, 'generated', 'anchors');
  const labDir = path.join(cwd, 'generated', 'lab');
  await mkdir(labDir, { recursive: true });

  const sourceBase = path.basename(body.sourceFilename);
  const sourceAbs = path.resolve(anchorsDir, sourceBase);
  const sourceBuf = await readFile(sourceAbs);

  let bytesArr: Uint8Array[];
  try {
    bytesArr = await transformImageViaFal({
      slug,
      prompt: body.prompt,
      sourceImage: sourceBuf,
      n,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await logCost(supabase, {
      msg: `✗ image-lab ${slug}: ${errMsg}`,
      ok: false,
      cost_usd: 0,
      model: slug,
      cost_source: 'estimate',
      composition: 'image-lab',
      route: 'fal',
      provider: 'bfl',
      native_unit: 'usd',
      native_amount: 0,
    });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }

  // Normalize each variant to spec aspect, then write to generated/lab/.
  const ts = Date.now();
  const tag = (body.sourceTag || sourceBase.replace(/-\d+\.[^.]+$/, '')).replace(/[^a-zA-Z0-9_-]/g, '');
  const variants: Array<{ filename: string; bytes: number }> = [];
  for (let i = 0; i < bytesArr.length; i++) {
    const out = await sharp(Buffer.from(bytesArr[i]))
      .resize(ASPECT.width, ASPECT.height, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer();
    const filename = `lab-${tag}-${ts}-${i + 1}.png`;
    await writeFile(path.join(labDir, filename), out);
    variants.push({ filename, bytes: out.byteLength });
  }

  const totalEstimate = Number((KONTEXT_USD_PER_IMAGE * bytesArr.length).toFixed(4));
  await logCost(supabase, {
    msg: `image-lab ${slug} ×${bytesArr.length} from ${sourceBase}: "${body.prompt.slice(0, 80)}"`,
    ok: true,
    cost_usd: totalEstimate,
    model: slug,
    cost_source: 'estimate',
    composition: 'image-lab',
    route: 'fal',
    provider: 'bfl',
    native_unit: 'usd',
    native_amount: totalEstimate,
  });

  return NextResponse.json({
    ok: true,
    sourceFilename: sourceBase,
    prompt: body.prompt,
    slug,
    variants,
    cost_estimate: totalEstimate,
  });
}
