/**
 * POST /admin/gen/reassess — AI quality check for a single segment transition.
 * Mirrors RWS baseline: api/admin/gen/reassess/route.ts.
 *
 * Sends two endpoint anchor images + the current segment prompt to a multimodal
 * chat model via AIAdapter.generateChat() and parses a strict-JSON verdict.
 */

import { errorResponse, jsonResponse, withAdmin, type RouteHandler } from '../types.js';
import type { RouteDeps } from '../types.js';
import type { CostLogStore } from '../../persistence/cost-log.js';
import type { SpecStore } from '../../persistence/spec-store.js';
import { COST_PER } from '../../lib/cost-constants.js';

export interface ReassessRouteDeps extends RouteDeps {
  specStore: SpecStore;
  costLog: CostLogStore;
  /** Chat model slug, e.g. "anthropic/claude-haiku-4-5". */
  chatModel: string;
  project?: string;
}

const SYSTEM_PROMPT = `You are a senior visual director reviewing a planned video segment that morphs between two still frames using image-to-video AI (Kling i2v with start+end frame conditioning). Be concise, concrete, and honest. Your job is to predict whether this specific transition will look smooth and cinematic, or jumpy / mismatched.

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

function bytesToDataUrl(bytes: Uint8Array, filename: string): string {
  const mime = filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return `data:${mime};base64,${b64}`;
}

function findLatestFile(filenames: string[], anchorId: string): string | undefined {
  const re = new RegExp(`^${anchorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{10,})\\.`);
  return filenames.filter((f) => re.test(f)).sort().reverse()[0];
}

export function makeReassessHandlers(deps: ReassessRouteDeps): { POST: RouteHandler } {
  return {
    POST: (req) =>
      withAdmin(req, deps.auth, async () => {
        const body = (await req.json()) as {
          segmentIndex: number;
          startAnchorFile?: string;
          endAnchorFile?: string;
        };
        const spec = await deps.specStore.load();
        const seg = spec.segments[body.segmentIndex];
        if (!seg) return errorResponse('unknown segmentIndex', 400);

        // Discover anchor files via storage (when override not supplied).
        let anchorFiles: string[] = [];
        if (await deps.storage.exists('anchors')) {
          anchorFiles = (await deps.storage.listDir('anchors')).map((f) => f.path.split('/').pop() ?? '');
        }
        const startFile = body.startAnchorFile ?? findLatestFile(anchorFiles, seg.startAnchor);
        const endFile = body.endAnchorFile ?? findLatestFile(anchorFiles, seg.endAnchor);
        if (!startFile || !endFile) {
          return errorResponse(`missing anchor image (start=${!!startFile}, end=${!!endFile})`, 400);
        }

        const startBytes = await deps.storage.readFile(`anchors/${startFile}`);
        const endBytes = await deps.storage.readFile(`anchors/${endFile}`);

        const userText = `Start anchor (frame A): "${seg.startAnchor}".
End anchor (frame B): "${seg.endAnchor}".
Current motion prompt sent to Kling i2v:
"""${seg.prompt}"""

Assess whether morphing A→B with this prompt will yield a smooth ${seg.duration}s clip. Then propose a tightened prompt that nudges Kling toward a continuous color and lighting drift between the two specific frames you see.`;

        let measured;
        try {
          measured = await deps.ai.generateChat({
            model: deps.chatModel,
            maxTokens: 700,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: userText },
                  { type: 'image_url', image_url: { url: bytesToDataUrl(startBytes, startFile) } },
                  { type: 'image_url', image_url: { url: bytesToDataUrl(endBytes, endFile) } },
                ],
              },
            ],
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await deps.costLog.append({
            msg: `✗ reassess segment ${body.segmentIndex + 1}: ${errMsg}`,
            ok: false,
            cost_usd: 0,
            model: deps.chatModel,
            cost_source: 'estimate',
            project: deps.project,
            route: 'gateway',
            provider: 'anthropic',
            native_unit: 'usd',
            native_amount: 0,
          });
          return errorResponse(errMsg, 502);
        }

        const raw = measured.result.text;
        // Defensive: extract first JSON object even if model wrapped in prose.
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return errorResponse('model did not return JSON', 502, { raw });
        let parsed: unknown;
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          return errorResponse('invalid JSON from model', 502, { raw });
        }

        const cost = measured.costUsd ?? COST_PER.haiku_estimate;
        const costSource = measured.costUsd != null ? 'measured' : 'estimate';
        await deps.costLog.append({
          msg: `reassess segment ${body.segmentIndex + 1}`,
          ok: true,
          cost_usd: cost,
          model: deps.chatModel,
          cost_source: costSource as 'measured' | 'estimate',
          project: deps.project,
          route: 'gateway',
          provider: 'anthropic',
          native_unit: 'usd',
          native_amount: cost,
        });

        return jsonResponse({
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
      }),
  };
}
