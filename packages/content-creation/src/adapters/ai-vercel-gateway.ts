/**
 * VercelAIGatewayAdapter — AIAdapter implementation backed by Vercel AI Gateway.
 *
 * Uses the gateway's OpenAI-compatible REST surface for chat completions and
 * image generation, plus the AI SDK's `experimental_generateVideo` for video
 * (Kling i2v) when the runtime ships it. Designed to lazily import the AI SDK
 * so non-video consumers don't pay the bundle cost.
 *
 * Auth: the adapter receives an async key getter so the consumer can pull the
 * gateway key from a vault on each call (see card 1bd980eb / wt_vault_inject_*).
 * Plaintext is never persisted in the adapter instance.
 */

import type {
  AIAdapter,
  ChatGenerateParams,
  ChatGenerateResult,
  ImageGenerateParams,
  ImageGenerateResult,
  MeasuredResult,
  ModelEntry,
  UsageReport,
  VideoGenerateParams,
  VideoGenerateResult,
} from './ai.js';

export interface VercelAIGatewayAdapterConfig {
  /** Async getter — pulled from vault on each call. Adapter never caches plaintext. */
  apiKey: () => Promise<string>;
  /** Override base URL (default: https://ai-gateway.vercel.sh/v1). */
  baseUrl?: string;
  /** fetch implementation (default: globalThis.fetch). Useful for tests. */
  fetch?: typeof fetch;
  /** Optional curated model list returned by listModels(). */
  curatedModels?: ModelEntry[];
}

const DEFAULT_BASE = 'https://ai-gateway.vercel.sh/v1';

export class VercelAIGatewayAdapter implements AIAdapter {
  private readonly cfg: Required<Pick<VercelAIGatewayAdapterConfig, 'baseUrl' | 'fetch'>> &
    VercelAIGatewayAdapterConfig;

  constructor(config: VercelAIGatewayAdapterConfig) {
    this.cfg = {
      ...config,
      baseUrl: (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, ''),
      fetch: config.fetch ?? (globalThis.fetch as typeof fetch),
    };
    if (!this.cfg.fetch) {
      throw new Error('VercelAIGatewayAdapter: no fetch available — pass config.fetch in non-browser/Node 18- runtimes');
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const key = await this.cfg.apiKey();
    if (!key) throw new Error('VercelAIGatewayAdapter: empty API key from getter');
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  }

  private static parseCostHeader(headers: Headers): number | null {
    // Gateway returns x-vercel-ai-gateway-cost-usd or similar.
    const candidates = [
      'x-vercel-ai-gateway-cost-usd',
      'x-ai-gateway-cost-usd',
      'x-vercel-ai-cost',
    ];
    for (const k of candidates) {
      const v = headers.get(k);
      if (v != null) {
        const n = parseFloat(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  async generateImage(params: ImageGenerateParams): Promise<MeasuredResult<ImageGenerateResult>> {
    const headers = await this.authHeaders();
    const res = await this.cfg.fetch(`${this.cfg.baseUrl}/images/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        size: params.size,
        ...(params.seed != null ? { seed: params.seed } : {}),
        ...(params.extras ?? {}),
      }),
    });
    const costUsd = VercelAIGatewayAdapter.parseCostHeader(res.headers);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`VercelAIGatewayAdapter.generateImage(${params.model}): ${res.status} ${errText}`);
    }
    const json = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
    const first = json.data?.[0];
    if (!first) throw new Error('VercelAIGatewayAdapter.generateImage: empty data array');
    return { result: { url: first.url, b64_json: first.b64_json }, costUsd };
  }

  async generateChat(params: ChatGenerateParams): Promise<MeasuredResult<ChatGenerateResult>> {
    const headers = await this.authHeaders();
    const res = await this.cfg.fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
      }),
    });
    const costUsd = VercelAIGatewayAdapter.parseCostHeader(res.headers);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`VercelAIGatewayAdapter.generateChat(${params.model}): ${res.status} ${errText}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    return { result: { text, costUsd: costUsd ?? undefined }, costUsd };
  }

  /**
   * Video generation defers to the consumer-supplied AI SDK `experimental_generateVideo`
   * because the gateway's video API surface is still settling and varies per provider.
   * Consumers wire this by passing a `videoCall` handler in extras OR by overriding
   * `generateVideo` in a subclass.
   *
   * Default behavior: throws — consumer must wire video explicitly.
   */
  async generateVideo(params: VideoGenerateParams): Promise<MeasuredResult<VideoGenerateResult>> {
    throw new Error(
      `VercelAIGatewayAdapter.generateVideo(${params.model}): not yet wired in v0.2.0-step4a — ` +
      'consumer should subclass and override, or wait for step4b which adds the AI SDK videoCall hook',
    );
  }

  async getUsage(): Promise<UsageReport> {
    const headers = await this.authHeaders();
    const res = await this.cfg.fetch(`${this.cfg.baseUrl}/usage`, { headers });
    if (!res.ok) {
      // /usage is gated on Vercel team admin access; non-fatal.
      return { raw: { error: `${res.status} ${res.statusText}` } };
    }
    const json = (await res.json()) as {
      remaining_usd?: number;
      spent_usd?: number;
    };
    return {
      remainingUsd: json.remaining_usd,
      spentUsd: json.spent_usd,
      raw: json,
    };
  }

  async listModels(): Promise<ModelEntry[]> {
    if (this.cfg.curatedModels?.length) return this.cfg.curatedModels;
    const headers = await this.authHeaders();
    const res = await this.cfg.fetch(`${this.cfg.baseUrl}/models`, { headers });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id: string; object?: string }> };
    return (json.data ?? []).map((m) => ({ slug: m.id, kind: 'unknown' as const }));
  }
}
