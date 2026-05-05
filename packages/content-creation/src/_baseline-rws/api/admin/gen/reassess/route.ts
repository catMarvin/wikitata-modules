// AI quality check for a single segment transition.
// Sends the two endpoint anchor images + current segment prompt to a multimodal
// model via Vercel AI Gateway and returns a verdict the page can render inline.
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { loadSpec } from '@/lib/spec-store';
import { logCost, COST_PER } from '@/lib/cost-log';
import { measureGatewayCost } from '@/lib/ai-gateway';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

const MODEL = 'anthropic/claude-haiku-4-5';
const GATEWAY = 'https://ai-gateway.vercel.sh';

async function loadImageAsDataUrl(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  const mime = absPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function findLatestFile(files: string[], prefix: string): string | undefined {
  const matches = files.filter((f) => f.startsWith(`${prefix}-`)).sort();
  return matches[matches.length - 1];
}

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as {
    segmentIndex: number;
    startAnchorFile?: string; // optional explicit override (e.g. user pinned a non-latest)
    endAnchorFile?: string;
  };

  const spec = await loadSpec();
  const seg = spec.segments[body.segmentIndex];
  if (!seg) return NextResponse.json({ error: 'unknown segmentIndex' }, { status: 400 });

  const cwd = process.cwd();
  const anchorsDir = path.join(cwd, 'generated', 'anchors');
  const { readdir } = await import('node:fs/promises');
  let files: string[] = [];
  try { files = await readdir(anchorsDir); } catch {}

  const startFile = body.startAnchorFile ?? findLatestFile(files, seg.startAnchor);
  const endFile = body.endAnchorFile ?? findLatestFile(files, seg.endAnchor);
  if (!startFile || !endFile) {
    return NextResponse.json({ error: `missing anchor image (start=${!!startFile}, end=${!!endFile})` }, { status: 400 });
  }

  const startUrl = await loadImageAsDataUrl(path.join(anchorsDir, startFile));
  const endUrl = await loadImageAsDataUrl(path.join(anchorsDir, endFile));

  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI_GATEWAY_API_KEY not set' }, { status: 500 });

  const systemPrompt = `You are a senior visual director reviewing a planned video segment that morphs between two still frames using image-to-video AI (Kling i2v with start+end frame conditioning). Be concise, concrete, and honest. Your job is to predict whether this specific transition will look smooth and cinematic, or jumpy / mismatched.

Return STRICT JSON only, matching this shape:
{
  "severity": "good" | "marginal" | "poor",
  "summary": "<1 sentence overall>",
  "issues": ["<short bullet>", ...],
  "suggestedPrompt": "<a revised motion prompt for Kling that addresses the issues above; preserve the painterly cinematic dreamlike vocabulary; 16:9>"
}

Severity guide:
- good: colors, lighting, framing, and composition are continuous; the AI will easily morph between them.
- marginal: notable mismatch (color temp, focal subject, scale) but salvageable with a sharper prompt.
- poor: discontinuous (different scenes, contradicting light direction, scale jumps); will produce a jumpy clip even with prompt help.`;

  const userText = `Start anchor (frame A): "${seg.startAnchor}".
End anchor (frame B): "${seg.endAnchor}".
Current motion prompt sent to Kling i2v:
"""${seg.prompt}"""

Assess whether morphing A→B with this prompt will yield a smooth ${seg.duration}s clip. Then propose a tightened prompt that nudges Kling toward a continuous color and lighting drift between the two specific frames you see.`;

  const measured = await measureGatewayCost(() => fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: startUrl } },
            { type: 'image_url', image_url: { url: endUrl } },
          ],
        },
      ],
    }),
  }));
  const res = measured.result;
  const measuredCost = measured.cost;

  if (!res.ok) {
    const errText = await res.text();
    const errMsg = `gateway error: ${res.status} ${errText.slice(0, 500)}`;
    await logCost(supabase, {
      msg: `✗ reassess segment ${body.segmentIndex + 1}: ${errMsg}`,
      ok: false,
      cost_usd: 0,
      model: MODEL,
      cost_source: 'estimate',
      project: 'rws',
      route: 'gateway',
      provider: 'anthropic',
      native_unit: 'usd',
      native_amount: 0,
    });
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }
  const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const raw = j.choices?.[0]?.message?.content ?? '';

  // The model is asked for strict JSON, but be defensive: extract the first JSON object in the response.
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) {
    return NextResponse.json({ error: 'model did not return JSON', raw }, { status: 502 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return NextResponse.json({ error: 'invalid JSON from model', raw }, { status: 502 });
  }

  const cost = measuredCost ?? COST_PER.haiku_estimate;
  const costSource = measuredCost != null ? 'measured' : 'estimate';
  await logCost(supabase, {
    msg: `reassess segment ${body.segmentIndex + 1}`,
    ok: true,
    cost_usd: cost,
    model: MODEL,
    cost_source: costSource,
    project: 'RWS',
    route: 'gateway',
    provider: 'anthropic',
    native_unit: 'usd',
    native_amount: cost,
  });

  return NextResponse.json({
    ok: true,
    segmentIndex: body.segmentIndex,
    startFile,
    endFile,
    assessment: parsed,
    raw,
    cost_usd: cost,
    cost_source: costSource,
    cost_estimate: COST_PER.haiku_estimate,
  });
}
