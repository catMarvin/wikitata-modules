// Local-dev-only orchestrator: synchronously generates a Kling video via AI Gateway
// (AI SDK's experimental_generateVideo handles the polling internally) and writes the
// resulting mp4 to ./generated/segments/.
import { NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { MODELS, videoModelById } from '@/lib/bg-spec';
import { loadSpec } from '@/lib/spec-store';
import { generateVideoBytes, measureGatewayCost } from '@/lib/ai-gateway';
import { generateVideoBytesViaFal } from '@/lib/fal';
import { logCost, COST_PER } from '@/lib/cost-log';
import { getAnchorPublicUrl } from '@/lib/storage';

function assertLocal() {
  if (process.env.VERCEL) throw new Error('local-only route');
}

// AI Gateway's Kling provider can take 5-12 minutes per clip. 800s is the Pro plan
// ceiling — covers the 12-min upper bound. Undici timeout is extended in instrumentation.ts.
export const maxDuration = 800;

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as {
    segmentIndex?: number;       // 0-based position in spec.segments
    startAnchor?: string;        // alternate identifier
    endAnchor?: string;
    startImagePath?: string;     // basename within generated/anchors/
    endImagePath?: string;
    promptOverride?: string;
    mode?: 'std' | 'pro';
    model?: string;              // override default video model
  };
  const requestedModel = body.model || MODELS.video;
  const modelInfo = videoModelById(requestedModel);
  // URL-mode models (Seedance/Wan/Grok) need anchors hosted on Supabase Storage.
  // Models with supportsBase64 receive raw bytes (Kling).
  const useUrlMode = modelInfo ? !modelInfo.supportsBase64 : false;
  const spec = await loadSpec();
  let segment = typeof body.segmentIndex === 'number' ? spec.segments[body.segmentIndex] : undefined;
  if (!segment && body.startAnchor && body.endAnchor) {
    segment = spec.segments.find((s) => s.startAnchor === body.startAnchor && s.endAnchor === body.endAnchor);
  }
  if (!segment) return NextResponse.json({ error: 'unknown segment' }, { status: 400 });
  if (!body.startImagePath) {
    return NextResponse.json({ error: 'startImagePath required' }, { status: 400 });
  }
  const segmentSlot = body.startAnchor && body.endAnchor
    ? `${body.startAnchor}__${body.endAnchor}`
    : `idx${body.segmentIndex}`;

  const cwd = process.cwd();
  const anchorsDir = path.join(cwd, 'generated', 'anchors');
  const startBase = path.basename(body.startImagePath);
  const endBase = body.endImagePath ? path.basename(body.endImagePath) : null;

  let startInput: Buffer | string;
  let endInput: Buffer | string | undefined;
  if (useUrlMode) {
    // Resolve anchor URLs from Supabase Storage. Filenames in /generated/anchors/
    // mirror the Storage paths since uploadAnchorImage writes the same name.
    startInput = await getAnchorPublicUrl(supabase, startBase);
    if (endBase) endInput = await getAnchorPublicUrl(supabase, endBase);
  } else {
    const startAbs = path.resolve(anchorsDir, startBase);
    startInput = await readFile(startAbs);
    if (endBase) {
      const endAbs = path.resolve(anchorsDir, endBase);
      endInput = await readFile(endAbs);
    }
  }

  const prompt = body.promptOverride ?? segment.prompt;

  let bytes: Uint8Array;
  let measuredCost: number | null = null;
  const route = modelInfo?.route ?? 'gateway';
  try {
    if (route === 'fal') {
      if (!modelInfo?.falSlug) throw new Error(`fal-routed model ${requestedModel} missing falSlug`);
      bytes = await generateVideoBytesViaFal({
        slug: modelInfo.falSlug,
        prompt,
        startImage: startInput,
        endImage: modelInfo.supportsTailFrame ? endInput : undefined,
        durationSeconds: segment.duration,
      });
      // fal.ai doesn't expose a per-call usage delta — measured cost stays null,
      // caller falls back to estimate from registry rate.
    } else {
      const measured = await measureGatewayCost(() => generateVideoBytes({
        model: requestedModel,
        prompt,
        startImage: startInput,
        endImage: modelInfo?.supportsTailFrame ? endInput : undefined,
        durationSeconds: segment.duration as 5 | 10,
        mode: body.mode ?? segment.mode ?? 'std',
        provider: modelInfo?.provider,
      }));
      bytes = measured.result;
      measuredCost = measured.cost;
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await logCost(supabase, {
      msg: `✗ video ${requestedModel} ${segmentSlot}: ${errMsg}`,
      ok: false,
      cost_usd: 0,
      model: requestedModel,
      cost_source: 'estimate',
      project: 'rws',
      route,
      provider: modelInfo?.provider,
      native_unit: 'usd',
      native_amount: 0,
    });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }

  const outDir = path.join(cwd, 'generated', 'segments');
  await mkdir(outDir, { recursive: true });
  const filename = `seg-${segmentSlot}-${Date.now()}.mp4`;
  const outPath = path.join(outDir, filename);
  await writeFile(outPath, bytes);

  const requestedMode = body.mode ?? segment.mode ?? 'std';
  // Mirror the auto-promote in generateVideoBytes: imageTail forces pro on Kling.
  const usedTailFrame = !!(modelInfo?.supportsTailFrame && endInput);
  const mode = usedTailFrame ? 'pro' : requestedMode;
  // Cost: prefer registry rate; fall back to legacy Kling constants.
  let rate: number = mode === 'pro' ? COST_PER.kling_pro_per_sec : COST_PER.kling_std_per_sec;
  if (modelInfo?.costPerSec) {
    rate = mode === 'pro' && modelInfo.costPerSec.pro != null ? modelInfo.costPerSec.pro : modelInfo.costPerSec.std;
  }
  const estimate = Number((segment.duration * rate).toFixed(4));
  const cost = measuredCost ?? estimate;
  const costSource = measuredCost != null ? 'measured' : 'estimate';
  await logCost(supabase, {
    msg: `${requestedModel} ${modelInfo?.modes ? mode + ' ' : ''}${segment.duration}s → ${segmentSlot}`,
    ok: true,
    cost_usd: cost,
    model: requestedModel,
    cost_source: costSource,
    project: 'RWS',
    route,
    provider: modelInfo?.provider,
    native_unit: 'usd',
    native_amount: cost,
  });

  return NextResponse.json({
    ok: true,
    segmentSlot,
    filename,
    localPath: outPath,
    bytes: bytes.byteLength,
    cost_usd: cost,
    cost_source: costSource,
    cost_estimate: estimate,
  });
}
