/**
 * AIAdapter — abstracts the AI generation backend used by the Backdrop pipeline
 * (image generation for anchors, video generation for segments, chat-completion
 * for the Reassess feature) and Compositor (text-driven layout suggestions in
 * future steps).
 *
 * The reference implementation `VercelAIGatewayAdapter` calls Vercel AI Gateway
 * which provides unified access to Flux, Kling i2v, Claude haiku, and others.
 * Consumers can ship their own implementation (direct provider, fal.ai, etc.).
 */

export interface ImageGenerateParams {
  /** Model slug, e.g. "bfl/flux-pro-1.1-ultra". */
  model: string;
  prompt: string;
  /** Output size, e.g. "1920x1080". */
  size: string;
  /** Optional seed. */
  seed?: number;
  /** Provider-specific extras passed through. */
  extras?: Record<string, unknown>;
}

export interface ImageGenerateResult {
  /** URL when the provider returns one. */
  url?: string;
  /** base64-encoded PNG/JPEG when the provider returns inline bytes. */
  b64_json?: string;
}

export interface VideoGenerateParams {
  /** Model slug, e.g. "kuaishou/kling-v2.6-i2v" or "fal-ai/seedance/i2v". */
  model: string;
  /** Source image as bytes (b64 path) or URL (URL-only models like Seedance). */
  image: { bytes: Uint8Array } | { url: string };
  /** Optional tail anchor for clip-to-clip blends. */
  imageTail?: { bytes: Uint8Array } | { url: string };
  prompt: string;
  /** Clip length in seconds (Kling supports 5 / 10). */
  durationSec: number;
  /** Quality mode (Kling: 'std' | 'pro'). */
  mode?: 'std' | 'pro';
  extras?: Record<string, unknown>;
}

export interface VideoGenerateResult {
  /** Final video bytes (mp4). Adapter handles any internal polling. */
  bytes: Uint8Array;
  /** Optional opaque provider job id, useful for telemetry. */
  jobId?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Either string content or multi-part (text + image_url) for vision models. */
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

export interface ChatGenerateParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatGenerateResult {
  /** Assistant text content. */
  text: string;
  /** Per-call cost in USD if the gateway reported it; undefined otherwise. */
  costUsd?: number;
}

export interface UsageReport {
  /** Remaining team credit in USD if the provider reports it. */
  remainingUsd?: number;
  /** Total spent USD this period if reported. */
  spentUsd?: number;
  /** Raw provider payload for tenant-side display. */
  raw?: unknown;
}

export interface ModelEntry {
  /** Provider/model slug (e.g. "bfl/flux-pro-1.1-ultra"). */
  slug: string;
  /** Human-readable label. */
  label?: string;
  /** Pricing string if known (e.g. "$0.06/image"). */
  pricing?: string;
  /** Capability category. */
  kind?: 'image' | 'video' | 'chat' | 'embedding' | 'unknown';
}

/**
 * Cost-measured call wrapper return.
 * Used by adapters that wrap a single network call to attribute cost.
 */
export interface MeasuredResult<T> {
  result: T;
  /** Actual cost reported by the gateway in USD, or null if unmeasured. */
  costUsd: number | null;
}

export interface AIAdapter {
  generateImage(params: ImageGenerateParams): Promise<MeasuredResult<ImageGenerateResult>>;
  generateVideo(params: VideoGenerateParams): Promise<MeasuredResult<VideoGenerateResult>>;
  generateChat(params: ChatGenerateParams): Promise<MeasuredResult<ChatGenerateResult>>;
  /** Implementations may return a partial UsageReport if the gateway exposes it. */
  getUsage(): Promise<UsageReport>;
  /** Implementations may return a curated subset; consumers can extend. */
  listModels(): Promise<ModelEntry[]>;
}
