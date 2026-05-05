/**
 * Spec — runtime-mutable Backdrop spec.
 *
 * The Backdrop pipeline operates on a Spec: an ordered list of anchor frames
 * (image stills) and segments (video clips bridging consecutive anchors).
 * In RWS this is persisted as `./generated/spec.json`. Genericized: persistence
 * is delegated to a `SpecStore` (currently JSON-on-StorageAdapter; a DB-backed
 * variant lands in step 7).
 *
 * Types lifted from RWS `src/lib/spec-store.ts` verbatim where stable.
 */

export type SpecAnchor = {
  id: string;
  label: string;
  prompt: string;
  seedFile?: string | null;
};

export type PromptHistoryEntry = {
  ts: number;
  prompt: string;
};

export type SpecSegment = {
  startAnchor: string;
  endAnchor: string;
  /** Kling supports 5s and 10s. */
  duration: 5 | 10;
  /** Kling generation mode. std = $0.042/s, pro = $0.07/s (better motion fidelity). */
  mode?: 'std' | 'pro';
  prompt: string;
  /** Past prompt edits, newest first. */
  promptHistory?: PromptHistoryEntry[];
};

export type Spec = {
  anchors: SpecAnchor[];
  /** Derived from anchor pairs but customizable per pair. */
  segments: SpecSegment[];
};

/**
 * Default cinematic bridge prompt between two anchors. Consumers can override
 * via SpecStoreConfig.bridgePrompt for project-specific tone.
 */
export function defaultBridgePrompt(a: SpecAnchor, b: SpecAnchor): string {
  return `Cinematic, painterly, dreamlike continuous motion drifting from "${a.label}" into "${b.label}". Smooth ethereal color shift, no jump cuts, gentle camera movement. Maintain continuity of light and atmosphere across the transition.`;
}

/**
 * Rebuild the segments list to follow current anchor order. Preserves any
 * existing per-pair prompt + duration + mode + history.
 */
export function rebuildSegments(
  spec: Spec,
  bridgePrompt: (a: SpecAnchor, b: SpecAnchor) => string = defaultBridgePrompt,
): Spec {
  const anchors = spec.anchors;
  const lookup = new Map<string, SpecSegment>();
  for (const s of spec.segments) lookup.set(`${s.startAnchor}→${s.endAnchor}`, s);

  const next: SpecSegment[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[(i + 1) % anchors.length]!;
    const existing = lookup.get(`${a.id}→${b.id}`);
    next.push(
      existing ?? {
        startAnchor: a.id,
        endAnchor: b.id,
        duration: 5,
        mode: 'std',
        prompt: bridgePrompt(a, b),
      },
    );
  }
  return { ...spec, segments: next };
}

/**
 * Validate a Spec payload (cheap structural check). Throws on bad shape.
 */
export function assertValidSpec(spec: unknown): asserts spec is Spec {
  if (!spec || typeof spec !== 'object') throw new Error('spec must be an object');
  const s = spec as Partial<Spec>;
  if (!Array.isArray(s.anchors) || s.anchors.length < 2) {
    throw new Error('spec must have at least 2 anchors');
  }
  for (const a of s.anchors) {
    if (typeof a.id !== 'string' || typeof a.label !== 'string' || typeof a.prompt !== 'string') {
      throw new Error('anchor missing id/label/prompt string');
    }
  }
  if (!Array.isArray(s.segments)) throw new Error('spec.segments must be an array');
}
