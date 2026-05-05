// Composition schema: a timeline of positioned, time-bounded layers (image, video,
// or text) rendered on top of a defined canvas. Used by the compositor editor and
// by the home-page hero overlay. Persisted as ./generated/compositions.json.

export type Box = {
  /** All values are percentages of the canvas (0-100). */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TransitionKind =
  | 'fade'
  | 'blur'
  | 'dither'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'wipe-left'
  | 'wipe-right'
  | 'scale-up'
  | 'scale-down';

export type Transition = { kind: TransitionKind; durationMs: number };

type LayerBase = {
  id: string;
  name: string;
  box: Box;
  startMs: number;
  endMs: number; // exclusive
  z: number;
  opacity?: number; // 0-1 base; transitions override during ramp
  transitionIn?: Transition;
  transitionOut?: Transition;
  visible?: boolean;
};

export type ImageLayer = LayerBase & {
  type: 'image';
  src: string;
  fit?: 'contain' | 'cover' | 'fill';
};

export type VideoLayer = LayerBase & {
  type: 'video';
  src: string;
  fit?: 'contain' | 'cover' | 'fill';
  loop?: boolean;
  muted?: boolean;
};

export type TextLayer = LayerBase & {
  type: 'text';
  text: string;
  fontFamily?: string;
  fontSizePct?: number; // % of canvas height (e.g. 8 = 8%)
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  color?: string;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'center' | 'bottom';
  lineHeight?: number;
  letterSpacingEm?: number;
  textShadow?: string;
};

export type Layer = ImageLayer | VideoLayer | TextLayer;

export type Composition = {
  id: string;
  name: string;
  slug: string; // stable identifier used by consumer pages (e.g. 'home-hero')
  canvas: {
    /** "16:9" | "9:16" | "1:1" | "4:5" or any "W:H" */
    aspectRatio: string;
    background?: string; // CSS color
  };
  durationMs: number; // for looping comps, the loop length
  loop?: boolean;
  layers: Layer[];
  updatedAt?: number;
};

/** Compute aspect ratio number from "W:H" string. */
export function aspectRatioToNumber(s: string): number {
  const [w, h] = s.split(':').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}

/** Determine effective opacity at time t (ms) for a layer, factoring transitions. */
export function effectiveOpacity(layer: Layer, t: number): number {
  if (t < layer.startMs || t >= layer.endMs) return 0;
  const base = layer.opacity ?? 1;
  const inDur = layer.transitionIn?.durationMs ?? 0;
  const outDur = layer.transitionOut?.durationMs ?? 0;
  const inEnd = layer.startMs + inDur;
  const outStart = layer.endMs - outDur;
  let mult = 1;
  if (layer.transitionIn?.kind === 'fade' && t < inEnd) {
    mult = (t - layer.startMs) / inDur;
  }
  if (layer.transitionOut?.kind === 'fade' && t > outStart) {
    mult = Math.min(mult, (layer.endMs - t) / outDur);
  }
  return base * Math.max(0, Math.min(1, mult));
}

/** CSS transform / filter for non-fade transitions at time t. Returns inline style fragments. */
export function transitionStyle(layer: Layer, t: number): { transform?: string; filter?: string; clipPath?: string } {
  const out: { transform?: string; filter?: string; clipPath?: string } = {};
  const inDur = layer.transitionIn?.durationMs ?? 0;
  const outDur = layer.transitionOut?.durationMs ?? 0;
  const inEnd = layer.startMs + inDur;
  const outStart = layer.endMs - outDur;

  function applyKind(kind: TransitionKind | undefined, p: number) {
    if (!kind) return;
    // p is progress 0..1 (0 = transition start, 1 = transition complete)
    const inv = 1 - p;
    switch (kind) {
      case 'blur':
        out.filter = `blur(${(inv * 24).toFixed(2)}px)`;
        break;
      case 'dither':
        out.filter = `blur(${(inv * 6).toFixed(2)}px) contrast(${(1 + inv).toFixed(2)}) saturate(${(1 + inv * 0.5).toFixed(2)})`;
        break;
      case 'slide-up':
        out.transform = `translateY(${(inv * 100).toFixed(2)}%)`;
        break;
      case 'slide-down':
        out.transform = `translateY(${(-inv * 100).toFixed(2)}%)`;
        break;
      case 'slide-left':
        out.transform = `translateX(${(inv * 100).toFixed(2)}%)`;
        break;
      case 'slide-right':
        out.transform = `translateX(${(-inv * 100).toFixed(2)}%)`;
        break;
      case 'wipe-up':
        out.clipPath = `inset(${(inv * 100).toFixed(2)}% 0 0 0)`;
        break;
      case 'wipe-down':
        out.clipPath = `inset(0 0 ${(inv * 100).toFixed(2)}% 0)`;
        break;
      case 'wipe-left':
        out.clipPath = `inset(0 0 0 ${(inv * 100).toFixed(2)}%)`;
        break;
      case 'wipe-right':
        out.clipPath = `inset(0 ${(inv * 100).toFixed(2)}% 0 0)`;
        break;
      case 'scale-up':
        out.transform = `scale(${(0.7 + p * 0.3).toFixed(3)})`;
        break;
      case 'scale-down':
        out.transform = `scale(${(1.3 - p * 0.3).toFixed(3)})`;
        break;
    }
  }

  if (layer.transitionIn && t < inEnd && inDur > 0) {
    const p = (t - layer.startMs) / inDur;
    applyKind(layer.transitionIn.kind, p);
  } else if (layer.transitionOut && t > outStart && outDur > 0) {
    const p = (layer.endMs - t) / outDur;
    applyKind(layer.transitionOut.kind, p);
  }
  return out;
}

/** Default seed composition used when ./generated/compositions.json is missing. */
export function seedCompositions(): Composition[] {
  const now = Date.now();
  const home: Composition = {
    id: 'home-hero',
    name: 'Home page hero',
    slug: 'home-hero',
    canvas: { aspectRatio: '16:9', background: '#0a0a0a' },
    durationMs: 8000,
    loop: true,
    updatedAt: now,
    layers: [
      {
        id: 'video-bg',
        name: 'Hero video (loop)',
        type: 'video',
        src: '/hero.mp4',
        fit: 'cover',
        loop: true,
        muted: true,
        box: { x: 0, y: 0, w: 100, h: 100 },
        startMs: 0,
        endMs: 8000,
        z: 0,
        opacity: 1,
      },
      {
        id: 'overlay-tone',
        name: 'Tone overlay',
        type: 'image',
        src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="black" stop-opacity="0.2"/><stop offset="50%" stop-color="black" stop-opacity="0.35"/><stop offset="100%" stop-color="black" stop-opacity="0.65"/></linearGradient></defs><rect width="100" height="100" fill="url(%23g)"/></svg>',
        fit: 'fill',
        box: { x: 0, y: 0, w: 100, h: 100 },
        startMs: 0,
        endMs: 8000,
        z: 1,
        opacity: 1,
      },
      {
        id: 'tagline',
        name: 'Tagline (italic)',
        type: 'text',
        text: 'Clairvoyant Readings with Scot Kowalski',
        fontFamily: 'serif',
        fontStyle: 'italic',
        fontSizePct: 3,
        color: '#fde7c7',
        align: 'center',
        vAlign: 'center',
        textShadow: '0 2px 16px rgba(0,0,0,0.6)',
        box: { x: 10, y: 30, w: 80, h: 8 },
        startMs: 0,
        endMs: 8000,
        z: 10,
        opacity: 0.95,
        transitionIn: { kind: 'fade', durationMs: 1000 },
        transitionOut: { kind: 'fade', durationMs: 800 },
      },
      {
        id: 'headline',
        name: 'Headline',
        type: 'text',
        text: "Clairvoyant Guidance for Life's Turning Points",
        fontFamily: 'serif',
        fontSizePct: 8,
        fontWeight: 600,
        color: '#ffffff',
        align: 'center',
        vAlign: 'center',
        lineHeight: 1.1,
        textShadow: '0 4px 32px rgba(0,0,0,0.8)',
        box: { x: 10, y: 38, w: 80, h: 24 },
        startMs: 500,
        endMs: 8000,
        z: 11,
        transitionIn: { kind: 'fade', durationMs: 1400 },
        transitionOut: { kind: 'fade', durationMs: 800 },
      },
    ],
  };
  return [home];
}
