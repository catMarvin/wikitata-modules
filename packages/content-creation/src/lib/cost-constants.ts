/**
 * Per-call cost estimates used as fallbacks when the gateway doesn't report
 * a `x-vercel-ai-gateway-cost-usd` header. Lifted from RWS `lib/cost-log.ts`.
 *
 * These should be treated as "best known at extraction time" and may drift.
 * Consumers can override per-instance via createBackdropRoutes deps.
 */

export const COST_PER = {
  /** Flux Pro 1.1 Ultra image */
  flux: 0.06,
  /** Kling i2v std mode, per second */
  kling_std_per_sec: 0.042,
  /** Kling i2v pro mode, per second */
  kling_pro_per_sec: 0.07,
  /** Anthropic Claude haiku — rough per-call estimate (text + 2 small images) */
  haiku_estimate: 0.005,
};
