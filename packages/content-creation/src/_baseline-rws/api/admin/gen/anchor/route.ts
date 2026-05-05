// Local-dev-only orchestrator: writes to ./generated/ on the developer's
// laptop (Next dev server has a writable fs). Refuses to run on Vercel.
import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { ASPECT, MODELS } from '@/lib/bg-spec';
import { loadSpec } from '@/lib/spec-store';
import { generateImage, measureGatewayCost } from '@/lib/ai-gateway';
import { logCost, COST_PER } from '@/lib/cost-log';
import { uploadAnchorImage } from '@/lib/storage';

function assertLocal() {
  if (process.env.VERCEL) {
    throw new Error('local-only route — runs from `next dev` only');
  }
}

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as { anchorId?: string; promptOverride?: string };
  const spec = await loadSpec();
  const anchor = spec.anchors.find((a) => a.id === body.anchorId);
  if (!anchor) return NextResponse.json({ error: 'unknown anchorId' }, { status: 400 });

  const prompt = body.promptOverride ?? anchor.prompt;

  let result: { url?: string; b64_json?: string };
  let measuredCost: number | null = null;
  try {
    const measured = await measureGatewayCost(() => generateImage({
      model: MODELS.image,
      prompt,
      size: `${ASPECT.width}x${ASPECT.height}`,
    }));
    result = measured.result;
    measuredCost = measured.cost;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await logCost(supabase, {
      msg: `✗ anchor ${anchor.id}: ${errMsg}`,
      ok: false,
      cost_usd: 0,
      model: MODELS.image,
      cost_source: 'estimate',
      project: 'rws',
      route: 'gateway',
      provider: 'bfl',
      native_unit: 'usd',
      native_amount: 0,
    });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }

  const cwd = process.cwd();
  const outDir = path.join(cwd, 'generated', 'anchors');
  await mkdir(outDir, { recursive: true });
  const ts = Date.now();
  const filename = `${anchor.id}-${ts}.png`;
  const outPath = path.join(outDir, filename);

  let imageBuf: Buffer;
  if (result.b64_json) {
    imageBuf = Buffer.from(result.b64_json, 'base64');
  } else if (result.url) {
    const r = await fetch(result.url);
    imageBuf = Buffer.from(await r.arrayBuffer());
  } else {
    return NextResponse.json({ error: 'no image data returned' }, { status: 500 });
  }
  // Write locally for the existing /api/admin/gen/file?kind=anchor flow + dev preview.
  await writeFile(outPath, imageBuf);
  // Also upload to Supabase Storage so URL-only video models (Seedance/Wan/Grok) can fetch it.
  let storagePublicUrl: string | null = null;
  try {
    const up = await uploadAnchorImage(supabase, filename, imageBuf);
    storagePublicUrl = up.publicUrl;
  } catch (e) {
    // Non-fatal — local file still works for Kling base64 path.
    console.warn('[anchor] storage upload failed:', e);
  }

  const cost = measuredCost ?? COST_PER.flux;
  const costSource = measuredCost != null ? 'measured' : 'estimate';
  await logCost(supabase, {
    msg: `flux anchor → ${anchor.id}`,
    ok: true,
    cost_usd: cost,
    model: MODELS.image,
    cost_source: costSource,
    project: 'RWS',
    route: 'gateway',
    provider: 'bfl',
    native_unit: 'usd',
    native_amount: cost,
  });

  return NextResponse.json({
    ok: true,
    anchorId: anchor.id,
    filename,
    localPath: outPath,
    publicUrl: storagePublicUrl ?? result.url ?? null,
    storageUrl: storagePublicUrl,
    cost_usd: cost,
    cost_source: costSource,
    cost_estimate: COST_PER.flux,
  });
}
