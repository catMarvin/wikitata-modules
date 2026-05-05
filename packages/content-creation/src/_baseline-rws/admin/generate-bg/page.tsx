'use client';

import { useEffect, useRef, useState } from 'react';

import SpendInline from '@/app/admin/_components/SpendInline';
import { ASPECT } from '@/lib/bg-spec';
import type { VideoModelInfo } from '@/lib/bg-spec';

const SPEC_RATIO = ASPECT.width / ASPECT.height;
const RATIO_TOLERANCE = 0.02; // ±2%

type SpecAnchor = { id: string; label: string; prompt: string; seedFile?: string | null };
type PromptHistoryEntry = { ts: number; prompt: string };
type SpecSegment = { startAnchor: string; endAnchor: string; duration: 5 | 10; mode?: 'std' | 'pro'; prompt: string; promptHistory?: PromptHistoryEntry[] };
const RATE_PER_SEC = { std: 0.042, pro: 0.07 } as const;
function segmentCost(s: SpecSegment) { return s.duration * RATE_PER_SEC[s.mode ?? 'std']; }
type Spec = { anchors: SpecAnchor[]; segments: SpecSegment[] };

type LogLine = { ts: number; msg: string; ok?: boolean };
type Progress = { key: string; startedAt: number; expectedMs: number; label: string };

const ETA = {
  anchor: 18_000,
  segment: 75_000,
  stitch: 8_000,
  upload: 3_000,
} as const;

function ProgressBar({ progress, now }: { progress: Progress; now: number }) {
  const elapsed = now - progress.startedAt;
  const pct = Math.min(95, 100 * (1 - Math.exp(-2.5 * (elapsed / progress.expectedMs))));
  const elapsedS = (elapsed / 1000).toFixed(1);
  const expectedS = (progress.expectedMs / 1000).toFixed(0);
  return (
    <div className="mt-1">
      <div className="h-1.5 bg-stone-200 rounded overflow-hidden">
        <div className="h-full bg-amber-700 transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-stone-500 mt-0.5 flex justify-between">
        <span>{progress.label}</span>
        <span>{elapsedS}s / ~{expectedS}s</span>
      </div>
    </div>
  );
}

function segmentSlot(s: SpecSegment) { return `${s.startAnchor}__${s.endAnchor}`; }

// Curated bridge suggestions per (before, after) pair. Surfaced as preset buttons in the insert dialog.
type BridgePreset = { label: string; prompt: string };
const BRIDGE_SUGGESTIONS: Record<string, BridgePreset[]> = {
  stars__return: [
    {
      label: '5a · twilight canopy haze',
      prompt:
        'Looking up through a high circular gap in a forest canopy at a deep pre-dawn sky. The Milky Way is now soft and fading, partially obscured by a faint warm haze rising from the forest below. The first hint of leaf silhouettes appears at the edges of the frame as branches begin to encroach into the view. The deep cobalt-indigo of the night sky is just barely warming toward the horizon — an almost imperceptible peach glow filtering up. Painterly, cinematic, dreamlike, contemplative dawn-of-return. Deep indigo, cobalt, dusty lavender, warm pre-dawn amber, soft cream stars dimmed. 16:9 widescreen, no people, no text, no airplane trails.',
    },
    {
      label: '5b · ivy threshold approach',
      prompt:
        'Approaching the silhouette of an arched ivy-covered window from a misty forest at deep dawn. The arch is dimly backlit by a warm amber interior glow, suggesting the bedroom waiting beyond. A few faint stars still linger in the upper sky, but the dominant feeling is of warm light pulling the viewer home. Trailing ivy and emerald leaves at the edges of the frame catch the last cool blue light from above and the warm glow from within. Painterly, cinematic, dreamlike, threshold moment between night and waking. Deep emerald greens, cool indigo shadows, warm amber and gold from inside the arch, soft cream highlights. 16:9 widescreen, no people, no text.',
    },
  ],
  bedroom__portal_interior: [
    {
      label: '1a · ivy frame closeup',
      prompt:
        'Slow tracking shot moving toward an arched window heavily framed with trailing ivy. The bedroom interior recedes behind us, soft warm afternoon light spills in from the arch ahead, the camera is just about to enter the threshold. Painterly, cinematic, dreamlike. Deep emerald, warm wood tones, soft gold highlights, gentle bokeh. 16:9 widescreen, no people, no text.',
    },
  ],
};

export default function GenerateBgPage() {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [anchorFiles, setAnchorFiles] = useState<Record<string, string>>({});
  const [segmentFiles, setSegmentFiles] = useState<Record<string, string>>({});
  const [anchorHistory, setAnchorHistory] = useState<Record<string, string[]>>({});
  const [segmentHistory, setSegmentHistory] = useState<Record<string, string[]>>({});
  type ArchiveRow = { filename: string; slot: string; archived_at: string; notes: string | null };
  const [archive, setArchive] = useState<ArchiveRow[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Per-anchor pixel dims (server-probed). Drives aspect-mismatch badges.
  const [anchorDims, setAnchorDims] = useState<Record<string, { w: number; h: number }>>({});
  // Image Lab — img2img scratchpad
  type LabRow = { filename: string; sourceTag: string; ts: number; variant: number };
  const [lab, setLab] = useState<LabRow[]>([]);
  const [labOpen, setLabOpen] = useState(false);
  const [labSource, setLabSource] = useState<string>('');
  const [labPrompt, setLabPrompt] = useState<string>('');
  const [labN, setLabN] = useState<number>(2);
  const [labSlug, setLabSlug] = useState<string>('fal-ai/flux-pro/kontext');
  const [labBusy, setLabBusy] = useState(false);
  const [anchorOverride, setAnchorOverride] = useState<Record<string, string>>({});
  const [segmentOverride, setSegmentOverride] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [insertAt, setInsertAt] = useState<number | null>(null);
  // Density: tighter = more anchors per row at a glance. Persisted.
  type Density = 0 | 1 | 2 | 3 | 4; // 0 = roomy, 4 = fit-to-width single row
  const [density, setDensity] = useState<Density>(1);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('rws-genbg-density');
      if (raw != null) setDensity(Number(raw) as Density);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('rws-genbg-density', String(density)); } catch {} }, [density]);
  type Assessment = {
    severity: 'good' | 'marginal' | 'poor';
    summary: string;
    issues: string[];
    suggestedPrompt: string;
  };
  const [assessments, setAssessments] = useState<Record<number, Assessment>>({});
  const [reassessBusy, setReassessBusy] = useState<number | null>(null);

  // Last successful stitch + last segment-change timestamps drive the "restitch needed" badge.
  const [lastStitchAt, setLastStitchAt] = useState<number | null>(null);
  const [lastSegmentChangeAt, setLastSegmentChangeAt] = useState<number>(0);
  const [stitchedFile, setStitchedFile] = useState<string | null>(null);

  // Floating preview panel state
  type OutputMode = 'floating' | 'pip' | 'fullscreen';
  type PreviewState = { x: number; y: number; w: number; opacity: number; minimized: boolean; playing: boolean; speed: number; closed: boolean; loop: boolean };
  const [preview, setPreview] = useState<PreviewState>({
    x: 24, y: 24, w: 360, opacity: 1, minimized: false, playing: false, speed: 1, closed: false, loop: false,
  });
  const [outputMode, setOutputMode] = useState<OutputMode>('floating');
  useEffect(() => {
    try {
      const raw = localStorage.getItem('rws-genbg-output-mode');
      if (raw === 'floating' || raw === 'pip' || raw === 'fullscreen') setOutputMode(raw);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('rws-genbg-output-mode', outputMode); } catch {} }, [outputMode]);
  const [writeBusy, setWriteBusy] = useState(false);
  // Batch render: per-segment selection (drives WHICH tiles get re-rendered).
  // selected[slot]=true → tile checkbox checked → included in batch render.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [batchBusy, setBatchBusy] = useState(false);
  // Play-queue inclusion (drives WHICH rendered segs play in the master player).
  // Default semantics: undefined → INCLUDED. Set to false to exclude. Independent of `selected`.
  const [playInclude, setPlayInclude] = useState<Record<string, boolean>>({});
  // Default ON: only render segments that don't already have a file.
  // Flip off to deliberately re-render existing segments.
  const [skipRendered, setSkipRendered] = useState(true);
  // AbortController for the in-flight batch — Stop button calls .abort().
  const batchAbortRef = useRef<AbortController | null>(null);
  type BatchSpend = { ts: number; segLabels: string[]; cost: number | null; estimate: number; ok: number; err: number };
  const [batchSpend, setBatchSpend] = useState<BatchSpend[]>([]);
  // Timestamp of the last error the user dismissed — banner hides any error <= this ts.
  const [errorAckedAt, setErrorAckedAt] = useState<number>(0);
  // Playlist for the "Play Selected" feature — sequence of segment file URLs piped
  // through the floating preview pane. null = use stitched file (existing behavior).
  const [playlist, setPlaylist] = useState<{ url: string; label: string; speed: number }[] | null>(null);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [playlistEnded, setPlaylistEnded] = useState(false);
  // Live playback progress (0..1) of the currently-playing clip — drives the
  // per-pill progress bar in the play queue strip.
  const [clipProgress, setClipProgress] = useState(0);
  // Per-segment playback speed override. Slot → multiplier (0.5–2.0).
  const [segmentSpeed, setSegmentSpeed] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem('rws-genbg-segment-speed');
      if (raw) setSegmentSpeed(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('rws-genbg-segment-speed', JSON.stringify(segmentSpeed)); } catch {} }, [segmentSpeed]);
  const [videoModels, setVideoModels] = useState<VideoModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('klingai/kling-v2.6-i2v');
  useEffect(() => {
    fetch('/api/admin/gen/models').then(async (r) => {
      if (!r.ok) return;
      const j = (await r.json()) as { models: VideoModelInfo[] };
      setVideoModels(j.models);
    }).catch(() => {});
    try {
      const saved = localStorage.getItem('rws-genbg-video-model');
      if (saved) setSelectedModelId(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('rws-genbg-video-model', selectedModelId); } catch {}
  }, [selectedModelId]);
  const activeModel = videoModels.find((m) => m.id === selectedModelId);

  useEffect(() => {
    if (!progress) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [progress]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('rws-genbg-log');
      if (raw) setLog(JSON.parse(raw) as LogLine[]);
      const ao = localStorage.getItem('rws-genbg-anchor-override');
      if (ao) setAnchorOverride(JSON.parse(ao));
      const so = localStorage.getItem('rws-genbg-segment-override');
      if (so) setSegmentOverride(JSON.parse(so));
      const pv = localStorage.getItem('rws-genbg-preview');
      if (pv) setPreview((p) => ({ ...p, ...JSON.parse(pv) }));
      const sm = localStorage.getItem('rws-genbg-stitch-meta');
      if (sm) {
        const m = JSON.parse(sm) as { lastStitchAt: number | null; stitchedFile: string | null };
        setLastStitchAt(m.lastStitchAt ?? null);
        setStitchedFile(m.stitchedFile ?? null);
      }
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('rws-genbg-log', JSON.stringify(log.slice(-500))); } catch {} }, [log]);
  useEffect(() => { try { localStorage.setItem('rws-genbg-anchor-override', JSON.stringify(anchorOverride)); } catch {} }, [anchorOverride]);
  useEffect(() => { try { localStorage.setItem('rws-genbg-segment-override', JSON.stringify(segmentOverride)); } catch {} }, [segmentOverride]);
  useEffect(() => {
    try {
      const { x, y, w, opacity, minimized, speed, closed, loop } = preview;
      localStorage.setItem('rws-genbg-preview', JSON.stringify({ x, y, w, opacity, minimized, speed, closed, loop }));
    } catch {}
  }, [preview.x, preview.y, preview.w, preview.opacity, preview.minimized, preview.speed, preview.closed, preview.loop]);
  useEffect(() => {
    try { localStorage.setItem('rws-genbg-stitch-meta', JSON.stringify({ lastStitchAt, stitchedFile })); } catch {}
  }, [lastStitchAt, stitchedFile]);
  // Mark "segment changed" timestamp whenever active selection or known files mutate.
  useEffect(() => { setLastSegmentChangeAt(Date.now()); }, [segmentOverride, segmentFiles, segmentHistory]);

  function clearLog() { setLog([]); try { localStorage.removeItem('rws-genbg-log'); } catch {} }
  async function archiveLog() {
    const before = Date.now();
    setLog([]);
    try { localStorage.removeItem('rws-genbg-log'); } catch {}
    try {
      const r = await fetch('/api/admin/gen/log', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive_visible', before }),
      });
      if (r.ok) {
        const j = await r.json();
        append(`📦 archived ${j.archivedCount ?? 0} log entries (still in Supabase, ?showArchived=1 to view)`, true);
      }
    } catch {}
  }
  function startProgress(key: string, expectedMs: number, label: string) { setProgress({ key, startedAt: Date.now(), expectedMs, label }); setNow(Date.now()); }
  // Two-tone chime on render completion. Synthesized via Web Audio so no asset
  // file needed. Respects localStorage mute toggle.
  function playDing(ok: boolean = true) {
    try {
      if (typeof window === 'undefined') return;
      if (localStorage.getItem('rws-genbg-mute-ding') === '1') return;
      type WindowWithAudioCtx = Window & {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
        __rwsAudioCtx?: AudioContext;
      };
      const w = window as WindowWithAudioCtx;
      const Ctx = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = w.__rwsAudioCtx ?? new Ctx();
      w.__rwsAudioCtx = ctx;
      const t0 = ctx.currentTime;
      const tones = ok ? [880, 1320] : [440, 330]; // success: A5→E6, error: A4→E4 descending
      tones.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        const start = t0 + i * 0.12;
        const dur = 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur);
      });
    } catch { /* user-gesture or autoplay block — ignore */ }
  }
  function endProgress() { setProgress(null); }
  function append(msg: string, ok?: boolean) {
    const ts = Date.now();
    setLog((l) => [...l, { ts, msg, ok }]);
    // Fire-and-forget durable persistence to Supabase so log survives localStorage wipes.
    fetch('/api/admin/gen/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg, ok, ts }),
      keepalive: true,
    }).catch(() => {});
  }

  async function refresh() {
    const r = await fetch('/api/admin/gen/state');
    if (r.ok) {
      const j = (await r.json()) as {
        anchors: Record<string, string>;
        segments: Record<string, string>;
        anchorHistory?: Record<string, string[]>;
        segmentHistory?: Record<string, string[]>;
        anchorDims?: Record<string, { w: number; h: number }>;
        archive?: Array<{ filename: string; slot: string; archived_at: string; notes: string | null }>;
        lab?: LabRow[];
        spec?: Spec;
      };
      setAnchorFiles(j.anchors);
      setSegmentFiles(j.segments);
      setAnchorHistory(j.anchorHistory ?? {});
      setSegmentHistory(j.segmentHistory ?? {});
      setAnchorDims(j.anchorDims ?? {});
      setArchive(j.archive ?? []);
      setLab(j.lab ?? []);
      if (j.spec) setSpec(j.spec);
    }
  }
  async function archiveSegment(slot: string, filename: string) {
    const r = await fetch('/api/admin/gen/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, filename }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      append(`✗ archive ${filename}: ${j.error ?? r.status}`, false);
      return;
    }
    append(`🗑 archived seg ${slot}/${filename}`);
    // Drop any active override pointing at the archived file.
    setSegmentOverride((o) => {
      if (o[slot] !== filename) return o;
      const n = { ...o }; delete n[slot]; return n;
    });
    await refresh();
  }
  async function unarchiveSegment(filename: string, targetSlot?: string) {
    const r = await fetch(`/api/admin/gen/archive?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      append(`✗ unarchive ${filename}: ${j.error ?? r.status}`, false);
      return;
    }
    append(`↩ restored ${filename}${targetSlot ? ` → ${targetSlot}` : ''}`);
    await refresh();
    // After refresh repopulates segmentHistory, optionally pin into target slot.
    if (targetSlot) setSegmentOverride((o) => ({ ...o, [targetSlot]: filename }));
  }
  useEffect(() => { refresh(); }, []);

  // Hydrate batch spend log from durable Supabase store on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/admin/gen/batch-log');
        if (!r.ok) return;
        const j = (await r.json()) as {
          entries: Array<{
            ts: string; seg_labels: string[]; ok_count: number; err_count: number;
            cost_measured: number | null; cost_estimate: number;
          }>;
        };
        if (cancelled) return;
        setBatchSpend(j.entries.map((e) => ({
          ts: new Date(e.ts).getTime(),
          segLabels: e.seg_labels,
          ok: e.ok_count,
          err: e.err_count,
          cost: e.cost_measured,
          estimate: Number(e.cost_estimate),
        })));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Hydrate the log from Supabase on first mount so it survives a localStorage clear.
  // Merges with any in-memory entries (de-duped by ts+msg), keeps newest 2000.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/admin/gen/log?limit=2000');
        if (!r.ok) return;
        const j = (await r.json()) as { entries: { ts: string; msg: string; ok: boolean | null }[] };
        if (cancelled) return;
        const remote: LogLine[] = j.entries.map((e) => ({
          ts: new Date(e.ts).getTime(),
          msg: e.msg,
          ok: e.ok ?? undefined,
        }));
        setLog((local) => {
          const seen = new Set(local.map((l) => `${l.ts}|${l.msg}`));
          const merged = [...local];
          for (const e of remote) {
            const key = `${e.ts}|${e.msg}`;
            if (!seen.has(key)) { merged.push(e); seen.add(key); }
          }
          merged.sort((a, b) => a.ts - b.ts);
          return merged.slice(-2000);
        });
      } catch { /* offline / forbidden — keep local */ }
    })();
    return () => { cancelled = true; };
  }, []);

  function activeAnchor(id: string): string | undefined {
    const ov = anchorOverride[id];
    const hist = anchorHistory[id] ?? [];
    if (ov && hist.includes(ov)) return ov;
    return anchorFiles[id];
  }
  function activeSegment(slot: string): string | undefined {
    const ov = segmentOverride[slot];
    const hist = segmentHistory[slot] ?? [];
    if (ov && hist.includes(ov)) return ov;
    return segmentFiles[slot];
  }

  async function genAnchor(anchorId: string) {
    setBusy(`anchor-${anchorId}`);
    startProgress(`anchor-${anchorId}`, ETA.anchor, `Flux rendering ${anchorId}`);
    append(`▶ generating anchor ${anchorId}…`);
    const r = await fetch('/api/admin/gen/anchor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchorId }),
    });
    const j = await r.json();
    if (r.ok) append(`✓ ${anchorId} → ${j.filename}`, true);
    else append(`✗ ${anchorId}: ${j.error ?? r.statusText}`, false);
    await refresh();
    endProgress();
    setBusy(null);
    playDing(r.ok);
  }

  async function uploadSeed(anchorId: string, file: File) {
    setBusy(`upload-${anchorId}`);
    startProgress(`upload-${anchorId}`, ETA.upload, `uploading ${anchorId}`);
    const fd = new FormData();
    fd.append('anchorId', anchorId);
    fd.append('file', file);
    const r = await fetch('/api/admin/gen/upload', { method: 'POST', body: fd });
    const j = await r.json();
    if (r.ok) append(`✓ uploaded seed ${anchorId} → ${j.filename}`, true);
    else append(`✗ upload ${anchorId}: ${j.error ?? r.statusText}`, false);
    await refresh();
    endProgress();
    setBusy(null);
  }

  // Inner render call — no progress bar / busy flag mutation. Used by both
  // single-segment Gen (wrapped in busy/progress) and the batch parallel path.
  async function renderSegmentInner(segIndex: number, signal?: AbortSignal): Promise<{ ok: boolean; filename?: string; error?: string }> {
    if (!spec) return { ok: false, error: 'no spec' };
    const seg = spec.segments[segIndex];
    if (!seg) return { ok: false, error: 'unknown segment' };
    const startFile = activeAnchor(seg.startAnchor);
    const endFile = activeAnchor(seg.endAnchor);
    if (!startFile) {
      append(`✗ segment ${segIndex + 1}: no start anchor (${seg.startAnchor})`, false);
      return { ok: false, error: 'no start anchor' };
    }
    append(`▶ generating segment ${segIndex + 1} (${seg.startAnchor} → ${seg.endAnchor}, ${seg.duration}s)…`);
    try {
      const r = await fetch('/api/admin/gen/video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          segmentIndex: segIndex,
          startAnchor: seg.startAnchor,
          endAnchor: seg.endAnchor,
          startImagePath: startFile,
          endImagePath: endFile ?? startFile,
          model: selectedModelId,
        }),
      });
      const j = await r.json();
      if (r.ok) {
        append(`✓ segment ${segIndex + 1} → ${j.filename}`, true);
        return { ok: true, filename: j.filename as string };
      }
      const err = (j.error as string | undefined) ?? r.statusText;
      append(`✗ segment ${segIndex + 1}: ${err}`, false);
      return { ok: false, error: err };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        append(`⏹ segment ${segIndex + 1}: aborted`, false);
        return { ok: false, error: 'aborted' };
      }
      const msg = e instanceof Error ? e.message : String(e);
      append(`✗ segment ${segIndex + 1}: ${msg}`, false);
      return { ok: false, error: msg };
    }
  }

  async function genSegment(segIndex: number) {
    if (!spec) return;
    const seg = spec.segments[segIndex];
    if (!seg) return;
    const slot = segmentSlot(seg);
    setBusy(`segment-${slot}`);
    const eta = seg.duration === 10 ? ETA.segment * 1.8 : ETA.segment;
    startProgress(`segment-${slot}`, eta, `Kling rendering segment ${segIndex + 1} (${seg.startAnchor} → ${seg.endAnchor}, ${seg.duration}s)`);
    const result = await renderSegmentInner(segIndex);
    await refresh();
    endProgress();
    setBusy(null);
    playDing(result.ok);
  }

  async function fetchBalance(): Promise<number | null> {
    try {
      const r = await fetch('/api/admin/gen/balance');
      if (!r.ok) return null;
      const j = (await r.json()) as { balance: number; totalUsed: number };
      return Number(j.totalUsed);
    } catch { return null; }
  }

  async function renderSelected() {
    if (!spec) return;
    const allSelected: number[] = [];
    spec.segments.forEach((s, i) => { if (selected[segmentSlot(s)]) allSelected.push(i); });
    if (!allSelected.length) {
      append('✗ batch: no segments selected', false);
      return;
    }
    // Apply skip-rendered filter unless user explicitly opted in to re-renders.
    const indices = skipRendered
      ? allSelected.filter((i) => !activeSegment(segmentSlot(spec.segments[i])))
      : allSelected;
    const skippedCount = allSelected.length - indices.length;
    if (!indices.length) {
      append(`✗ batch: all ${allSelected.length} selected segments already rendered. Toggle "include re-renders" to force.`, false);
      return;
    }
    if (skippedCount > 0) {
      append(`▶ batch: skipping ${skippedCount} already-rendered segment${skippedCount === 1 ? '' : 's'} (toggle "include re-renders" to override)`);
    }
    setBatchBusy(true);
    const controller = new AbortController();
    batchAbortRef.current = controller;
    const labels = indices.map((i) => String(i + 1));
    const estimate = indices.reduce((acc, i) => acc + segmentCost(spec.segments[i]), 0);
    const eta = indices.reduce((acc, i) => acc + (spec.segments[i].duration === 10 ? ETA.segment * 1.8 : ETA.segment), 0) / Math.max(1, indices.length);
    startProgress('batch', eta, `parallel render ${labels.join(',')} (~${labels.length} segments, est $${estimate.toFixed(2)})`);
    append(`▶ batch render: segments ${labels.join(', ')} in parallel (est $${estimate.toFixed(2)})`);
    const before = await fetchBalance();
    const results = await Promise.all(indices.map((i) => renderSegmentInner(i, controller.signal)));
    const after = await fetchBalance();
    const measured = before != null && after != null ? Number((after - before).toFixed(4)) : null;
    const ok = results.filter((r) => r.ok).length;
    const err = results.length - ok;
    const costStr = measured != null ? `$${measured.toFixed(4)} measured` : `~$${estimate.toFixed(2)} est`;
    append(`📊 batch ${labels.join(',')} → ${ok} ok / ${err} err · ${costStr}`, err === 0);
    const ts = Date.now();
    setBatchSpend((s) => [{ ts, segLabels: labels, cost: measured, estimate, ok, err }, ...s].slice(0, 50));
    // Durable: persist to Supabase (fire-and-forget; UI already updated optimistically).
    fetch('/api/admin/gen/batch-log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ts, segIndices: indices, segLabels: labels,
        okCount: ok, errCount: err,
        costMeasured: measured, costEstimate: estimate,
        balanceBefore: before, balanceAfter: after,
        model: selectedModelId,
      }),
      keepalive: true,
    }).catch(() => {});
    await refresh();
    endProgress();
    batchAbortRef.current = null;
    setBatchBusy(false);
    // Two-tone success unless every render failed
    const okN = results.filter((r) => r.ok).length;
    playDing(okN > 0);
  }

  function abortBatch() {
    if (batchAbortRef.current) {
      batchAbortRef.current.abort();
      append('⏹ batch: abort requested (in-flight provider jobs may still complete and bill)', false);
    }
  }

  function toggleSelect(slot: string) {
    setSelected((s) => ({ ...s, [slot]: !s[slot] }));
  }
  function isPlayIncluded(slot: string) { return playInclude[slot] !== false; }
  function togglePlayInclude(slot: string) {
    setPlayInclude((m) => {
      const cur = m[slot] !== false; // default true
      const next = { ...m };
      if (cur) next[slot] = false; else delete next[slot];
      return next;
    });
  }
  function playIncludeAll() {
    if (!spec) return;
    setPlayInclude({}); // clear all overrides → defaults all to included
  }
  function playIncludeNone() {
    if (!spec) return;
    const next: Record<string, boolean> = {};
    spec.segments.forEach((s) => {
      const slot = segmentSlot(s);
      if (activeSegment(slot)) next[slot] = false;
    });
    setPlayInclude(next);
  }
  function playSelected() {
    if (!spec) return;
    const items: { url: string; label: string; speed: number }[] = [];
    const missing: string[] = [];
    spec.segments.forEach((s, i) => {
      const slot = segmentSlot(s);
      if (!isPlayIncluded(slot)) return;
      const file = activeSegment(slot);
      if (!file) { missing.push(String(i + 1)); return; }
      items.push({
        url: `/api/admin/gen/file?kind=segment&name=${encodeURIComponent(file)}`,
        label: `seg ${i + 1}`,
        speed: segmentSpeed[slot] ?? 1,
      });
    });
    if (!items.length) {
      append(`✗ play: no rendered segments included${missing.length ? ` (${missing.join(',')} not yet rendered)` : ''}`, false);
      return;
    }
    if (missing.length) append(`▶ play: skipping unrendered segs ${missing.join(',')}`);
    append(`▶ play: queueing ${items.length} segments → ${items.map((x) => `${x.label}${x.speed !== 1 ? `@${x.speed}x` : ''}`).join(' → ')}`);
    setPlaylist(items);
    setPlaylistIndex(0);
    setPlaylistEnded(false);
    // Force loop OFF so the playlist actually advances. Reuse existing PIP position.
    setPreview((p) => ({ ...p, minimized: false, closed: false, playing: true, loop: false }));
  }
  function stopPlaylist() { setPlaylist(null); setPlaylistIndex(0); setPlaylistEnded(false); }
  function playOneSegment(segIndex: number) {
    if (!spec) return;
    const s = spec.segments[segIndex];
    const slot = segmentSlot(s);
    const file = activeSegment(slot);
    if (!file) return;
    const item = {
      url: `/api/admin/gen/file?kind=segment&name=${encodeURIComponent(file)}`,
      label: `seg ${segIndex + 1}`,
      speed: segmentSpeed[slot] ?? 1,
    };
    append(`▶ play one: ${item.label}${item.speed !== 1 ? ` @${item.speed}x` : ''} → PIP`);
    setPlaylist([item]);
    setPlaylistIndex(0);
    setPlaylistEnded(false);
    setPreview((p) => ({ ...p, minimized: false, closed: false, playing: true, loop: false }));
  }
  function nudgeSegmentSpeed(slot: string, delta: number) {
    setSegmentSpeed((m) => {
      const cur = m[slot] ?? 1;
      const next = Math.round(Math.max(0.25, Math.min(2, cur + delta)) * 100) / 100;
      const out = { ...m };
      if (next === 1) delete out[slot]; else out[slot] = next;
      return out;
    });
  }
  function selectAll() {
    if (!spec) return;
    const next: Record<string, boolean> = {};
    spec.segments.forEach((s) => { next[segmentSlot(s)] = true; });
    setSelected(next);
  }
  function selectNone() { setSelected({}); }

  async function backfillAnchors() {
    append('▶ backfill: scanning /generated/anchors/ → hero-anchors Storage…');
    try {
      const r = await fetch('/api/admin/gen/backfill-anchors', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) {
        append(`✗ backfill: ${j.error ?? r.statusText}`, false);
        return;
      }
      const t = j.totals as { scanned: number; uploaded: number; skipped: number; failed: number };
      append(`✓ backfill: scanned ${t.scanned} · uploaded ${t.uploaded} · skipped ${t.skipped} (already present)${t.failed ? ` · failed ${t.failed}` : ''}`, t.failed === 0);
      if (t.failed > 0) {
        for (const f of (j.failed as { name: string; error: string }[]).slice(0, 5)) {
          append(`  ✗ ${f.name}: ${f.error}`, false);
        }
      }
    } catch (e) {
      append(`✗ backfill: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  async function stitch() {
    setBusy('stitch');
    startProgress('stitch', ETA.stitch, 'ffmpeg xfade chain');
    append('▶ stitching segments + crossfades via ffmpeg…');
    const r = await fetch('/api/admin/gen/stitch', { method: 'POST' });
    const j = await r.json();
    if (r.ok) {
      append(`✓ stitched → ${j.filename} (${j.durationS}s, ${j.sizeMb} MB)`, true);
      setStitchedFile(j.filename);
      setLastStitchAt(Date.now());
    } else {
      append(`✗ stitch: ${j.error ?? r.statusText}`, false);
    }
    await refresh();
    endProgress();
    setBusy(null);
  }

  async function writeProject() {
    setWriteBusy(true);
    append('▶ writing project snapshot to Supabase…');
    const r = await fetch('/api/admin/gen/write-project', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchorOverride, segmentOverride, stitchedFile }),
    });
    const j = await r.json();
    if (r.ok) append(`✓ snapshot ${j.snapshotId} → ${j.uploaded} files, ${j.manifestRows} rows ($${(j.bytes / 1_000_000).toFixed(1)} MB)`, true);
    else append(`✗ write-project: ${j.error ?? r.statusText}`, false);
    setWriteBusy(false);
  }

  async function insertAnchor(afterIndex: number, label: string, prompt: string) {
    setBusy('insert');
    startProgress('insert', 1500, 'inserting anchor');
    const r = await fetch('/api/admin/gen/spec/insert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afterIndex, label, prompt }),
    });
    const j = await r.json();
    if (r.ok) append(`✓ inserted anchor ${j.insertedId} after #${afterIndex + 1}`, true);
    else append(`✗ insert: ${j.error ?? r.statusText}`, false);
    await refresh();
    endProgress();
    setBusy(null);
    setInsertAt(null);
  }

  async function patchSegment(index: number, patch: Partial<SpecSegment>, label: string) {
    if (!spec) return;
    const next: Spec = {
      ...spec,
      segments: spec.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    };
    setSpec(next);
    const r = await fetch('/api/admin/gen/spec', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (r.ok) {
      const saved = (await r.json()) as Spec;
      setSpec(saved);
      append(`✓ segment ${index + 1} ${label}`, true);
    } else {
      append(`✗ segment ${index + 1} ${label}: ${r.statusText}`, false);
      await refresh();
    }
  }
  const setSegmentDuration = (i: number, duration: 5 | 10) => patchSegment(i, { duration }, `duration → ${duration}s`);
  const setSegmentMode = (i: number, mode: 'std' | 'pro') => patchSegment(i, { mode }, `mode → ${mode}`);
  const setSegmentPrompt = (i: number, prompt: string) => {
    if (!spec) return;
    const seg = spec.segments[i];
    if (!seg || seg.prompt === prompt) return;
    const trimmedOld = seg.prompt?.trim();
    const history = seg.promptHistory ?? [];
    // Skip duplicates: don't push if old prompt already at the top of history.
    const nextHistory = trimmedOld && history[0]?.prompt !== trimmedOld
      ? [{ ts: Date.now(), prompt: seg.prompt }, ...history].slice(0, 50)
      : history;
    patchSegment(i, { prompt, promptHistory: nextHistory }, `prompt updated`);
  };
  const [editingPrompt, setEditingPrompt] = useState<number | null>(null);

  async function reassessSegment(i: number) {
    if (!spec) return;
    const seg = spec.segments[i];
    setReassessBusy(i);
    append(`▶ reassess segment ${i + 1} (${seg.startAnchor} → ${seg.endAnchor})…`);
    const r = await fetch('/api/admin/gen/reassess', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segmentIndex: i,
        startAnchorFile: anchorOverride[seg.startAnchor],
        endAnchorFile: anchorOverride[seg.endAnchor],
      }),
    });
    const j = await r.json();
    if (r.ok && j.assessment) {
      setAssessments((a) => ({ ...a, [i]: j.assessment as Assessment }));
      append(`✓ segment ${i + 1} reassess: ${j.assessment.severity} — ${j.assessment.summary}`, j.assessment.severity !== 'poor');
    } else {
      append(`✗ reassess segment ${i + 1}: ${j.error ?? r.statusText}`, false);
    }
    setReassessBusy(null);
  }

  async function deleteAnchor(id: string) {
    if (!confirm(`Delete anchor "${id}"? Existing rendered files stay on disk; segments touching this anchor will be removed from the loop.`)) return;
    setBusy(`delete-${id}`);
    const r = await fetch('/api/admin/gen/spec/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const j = await r.json();
    if (r.ok) append(`✓ deleted anchor ${id}`, true);
    else append(`✗ delete ${id}: ${j.error ?? r.statusText}`, false);
    await refresh();
    setBusy(null);
  }

  if (!spec) {
    return <div className="p-8 text-stone-500">loading spec…</div>;
  }

  const anchors = spec.anchors;
  const segments = spec.segments;
  const totalDuration = segments.reduce((a, s) => a + s.duration, 0);
  const estCostUsd = segments.reduce((a, s) => a + segmentCost(s), 0).toFixed(2);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <h1 className="text-3xl font-semibold">Generate Hero Background</h1>
        {(() => {
          const isStale = lastStitchAt != null && lastSegmentChangeAt > lastStitchAt;
          const ready = Object.keys(segmentFiles).length >= segments.length;
          return (
            <div className="flex items-center gap-2 flex-wrap mt-12 md:mt-10" data-tooltip="Section 4: Stitch + finalize">
              <button type="button" onClick={stitch}
                disabled={!!busy || batchBusy || !ready}
                data-tooltip={ready ? 'Stitch all rendered segments into loop.mp4' : `Need all ${segments.length} segments rendered first`}
                className="text-xs px-3 py-1.5 bg-amber-700 text-white rounded disabled:opacity-50">
                {busy === 'stitch' ? 'Stitching…' : isStale ? `↻ Restitch (${segments.length})` : `Stitch (${segments.length}) → loop.mp4`}
              </button>
              {isStale && (
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded">⚠ stale</span>
              )}
              <button type="button" onClick={writeProject}
                disabled={writeBusy || !!busy}
                data-tooltip="Snapshot generated/* + spec.json to Supabase storage + manifest"
                className="text-xs px-3 py-1.5 border border-amber-700 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50">
                {writeBusy ? 'Writing…' : '⤴ Write project'}
              </button>
            </div>
          );
        })()}
      </div>
      <p className="text-sm text-stone-600 mb-3">
        Local-dev orchestrator. {anchors.length} anchors · {segments.length} segments · <strong>{totalDuration}s loop</strong> · est. video cost <strong>${estCostUsd}</strong>. Plus image-gen at $0.06 per Flux render. Billed via Vercel AI Gateway. Output: <code>generated/loop-&lt;ts&gt;.mp4</code> → copy to <code>public/hero.mp4</code> when ready.
      </p>
      {videoModels.length > 0 && (
        <div className="mb-6 flex items-center flex-wrap gap-2 p-2 border border-stone-200 rounded bg-stone-50">
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Video model</span>
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            disabled={!!busy || batchBusy}
            className="text-xs border border-stone-300 rounded px-2 py-1 bg-white text-stone-900 max-w-md"
          >
            {(() => {
              // Group models by service-provider route. Order: Vercel AI Gateway first
              // (default for legacy entries), then fal.ai, then any future routes.
              const ROUTE_LABEL: Record<string, string> = {
                gateway: 'VERCEL AI GATEWAY',
                fal: 'FAL.AI (direct)',
              };
              const ROUTE_ORDER = ['gateway', 'fal'];
              const groups = new Map<string, typeof videoModels>();
              videoModels.forEach((m) => {
                const r = m.route ?? 'gateway';
                if (!groups.has(r)) groups.set(r, []);
                groups.get(r)!.push(m);
              });
              const sortedRoutes = Array.from(groups.keys()).sort(
                (a, b) => (ROUTE_ORDER.indexOf(a) - ROUTE_ORDER.indexOf(b)) || a.localeCompare(b),
              );
              return sortedRoutes.map((r) => (
                <optgroup key={r} label={ROUTE_LABEL[r] ?? r.toUpperCase()}>
                  {groups.get(r)!.map((m) => {
                    const tag = m.supportsBase64 ? '' : ' · (URL · needs anchor regen)';
                    return (
                      <option key={m.id} value={m.id}>
                        {m.label} {m.costPerSec ? `· $${m.costPerSec.std.toFixed(3)}/s` : ''}{tag}
                      </option>
                    );
                  })}
                </optgroup>
              ));
            })()}
          </select>
          {activeModel && (() => {
            const route = activeModel.route ?? 'gateway';
            const routeBadge = route === 'fal'
              ? { label: 'fal.ai', cls: 'bg-purple-100 text-purple-800' }
              : { label: 'Vercel AI Gateway', cls: 'bg-blue-100 text-blue-800' };
            return (
              <span className="text-[11px] text-stone-600 flex items-center gap-1" title={`${activeModel.benefits}${activeModel.notes ? '\n\n' + activeModel.notes : ''}`}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold cursor-help" aria-label="Model info">i</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${routeBadge.cls}`}
                  title={`Service provider: ${routeBadge.label}`}>{routeBadge.label}</span>
                <span className="font-mono text-[10px] text-stone-500">{activeModel.id}</span>
                {activeModel.supportsTailFrame && <span className="text-[10px] text-emerald-700">✓ first+last</span>}
                {activeModel.modes && <span className="text-[10px] text-stone-500">std/pro</span>}
              </span>
            );
          })()}
          {activeModel && (
            <details className="ml-auto">
              <summary className="text-[11px] text-stone-500 cursor-pointer hover:text-stone-900">benefits ▾</summary>
              <div className="absolute mt-1 right-0 z-30 bg-white border border-stone-300 rounded shadow-lg p-3 text-[11px] max-w-sm leading-relaxed">
                <div className="font-semibold text-stone-800 mb-1">{activeModel.label}</div>
                <div className="text-stone-700">{activeModel.benefits}</div>
                {activeModel.notes && <div className="mt-2 text-amber-700">{activeModel.notes}</div>}
              </div>
            </details>
          )}
        </div>
      )}

      {/* === Section 0: Image Lab — img2img scratchpad (collapsible) === */}
      <section className="mb-6 border border-stone-300 rounded">
        <button type="button" onClick={() => setLabOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-stone-50">
          <span className="text-sm font-bold uppercase tracking-wide text-stone-700">
            🪄 0. Image Lab <span className="text-stone-500 font-normal normal-case tracking-normal">— transform any anchor via fal.ai kontext{lab.length ? ` · ${lab.length} variant${lab.length === 1 ? '' : 's'}` : ''}</span>
          </span>
          <span className="text-stone-400 text-xs">{labOpen ? '▴ collapse' : '▾ expand'}</span>
        </button>
        {labOpen && (
          <div className="p-3 border-t border-stone-200 space-y-3 bg-stone-50">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5 min-w-[200px]">
                <span className="text-[10px] uppercase tracking-wide text-stone-500">Source anchor</span>
                <select value={labSource} onChange={(e) => setLabSource(e.target.value)}
                  className="text-xs border border-stone-300 rounded px-2 py-1 bg-white">
                  <option value="">— pick anchor —</option>
                  {anchors.map((a) => {
                    const f = activeAnchor(a.id);
                    if (!f) return null;
                    return <option key={a.id} value={f}>#{a.id} · {a.label}</option>;
                  })}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 flex-1 min-w-[280px]">
                <span className="text-[10px] uppercase tracking-wide text-stone-500">Prompt (what to change)</span>
                <input type="text" value={labPrompt} onChange={(e) => setLabPrompt(e.target.value)}
                  placeholder='e.g. "shift to twilight, deep purple sky"'
                  className="text-xs border border-stone-300 rounded px-2 py-1 bg-white" />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-stone-500">Variants</span>
                <select value={labN} onChange={(e) => setLabN(Number(e.target.value))}
                  className="text-xs border border-stone-300 rounded px-2 py-1 bg-white">
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 min-w-[180px]">
                <span className="text-[10px] uppercase tracking-wide text-stone-500">Model</span>
                <select value={labSlug} onChange={(e) => setLabSlug(e.target.value)}
                  className="text-xs border border-stone-300 rounded px-2 py-1 bg-white">
                  <option value="fal-ai/flux-pro/kontext">flux-pro/kontext (fal)</option>
                  <option value="fal-ai/flux-pro/kontext-max">flux-pro/kontext-max (fal)</option>
                </select>
              </label>
              <button type="button"
                onClick={async () => {
                  if (!labSource || !labPrompt.trim()) {
                    append('✗ image-lab: pick a source anchor and enter a prompt', false);
                    return;
                  }
                  setLabBusy(true);
                  try {
                    const r = await fetch('/api/admin/gen/transform-image', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sourceFilename: labSource, prompt: labPrompt, n: labN, slug: labSlug }),
                    });
                    const j = await r.json();
                    if (!r.ok) {
                      append(`✗ image-lab: ${j.error ?? r.status}`, false);
                    } else {
                      append(`🪄 image-lab ${labSlug} ×${j.variants?.length ?? 0} from ${j.sourceFilename} (~$${(j.cost_estimate ?? 0).toFixed(3)})`, true);
                      await refresh();
                    }
                  } finally { setLabBusy(false); }
                }}
                disabled={labBusy || !labSource || !labPrompt.trim()}
                className="px-3 py-1 bg-purple-700 text-white rounded disabled:opacity-50 text-xs font-semibold">
                {labBusy ? '… transforming' : '🪄 Transform'}
              </button>
            </div>
            {lab.length > 0 ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                {lab.map((row) => {
                  const url = `/api/admin/gen/file?kind=lab&name=${encodeURIComponent(row.filename)}`;
                  const tsLabel = new Date(row.ts).toLocaleTimeString();
                  return (
                    <div key={row.filename} className="border border-stone-200 rounded p-2 flex flex-col gap-1.5 bg-white">
                      <a href={url} title="Open in popup (one window per image — reclick refocuses)"
                        onClick={(e) => {
                          e.preventDefault();
                          const winName = `rws-img-${row.filename.replace(/[^a-zA-Z0-9]/g, '_')}`;
                          const w = window.open(url, winName, 'popup,width=1280,height=800');
                          if (w) w.focus();
                        }}>
                        <img src={url} alt={row.filename} className="w-full aspect-video object-cover rounded bg-black hover:opacity-90 transition cursor-zoom-in" />
                      </a>
                      <div className="text-[10px] text-stone-500 truncate" title={row.filename}>{row.sourceTag} · v{row.variant} · {tsLabel}</div>
                      <div className="flex items-center gap-1">
                        <select
                          defaultValue=""
                          onChange={async (e) => {
                            const anchorId = e.target.value;
                            if (!anchorId) return;
                            try {
                              const r = await fetch('/api/admin/gen/promote-lab', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ labFilename: row.filename, anchorId }),
                              });
                              const j = await r.json();
                              if (!r.ok) {
                                append(`✗ promote ${row.filename}: ${j.error ?? r.status}`, false);
                              } else {
                                append(`✓ promoted lab → anchor #${anchorId} (${j.filename})`, true);
                                await refresh();
                              }
                            } finally { e.currentTarget.value = ''; }
                          }}
                          className="text-[10px] border border-stone-300 rounded px-1 py-0.5 bg-white flex-1 min-w-0"
                          title="Promote this variant to an anchor slot">
                          <option value="">↑ Use as anchor…</option>
                          {anchors.map((a) => <option key={a.id} value={a.id}>#{a.id} · {a.label}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[11px] text-stone-500 italic">No transforms yet. Pick a source anchor + prompt above.</div>
            )}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-2xl font-bold uppercase tracking-wide flex items-center gap-2 flex-wrap">1. Anchors <span className="text-stone-500 font-normal text-base normal-case tracking-normal">({anchors.length} frames)</span>{(() => {
            const mismatched = Object.values(anchorDims).filter((d) => Math.abs((d.w / d.h) - SPEC_RATIO) / SPEC_RATIO > RATIO_TOLERANCE);
            if (!mismatched.length) return null;
            return <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded bg-red-100 text-red-800 border border-red-300"
              title={`${mismatched.length} anchor${mismatched.length === 1 ? '' : 's'} not at spec aspect (${ASPECT.width}×${ASPECT.height} · 16:9). Re-render before using in video — Kling output inherits start-anchor aspect.`}>⚠ {mismatched.length} aspect mismatch</span>;
          })()}</h2>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={backfillAnchors} disabled={!!busy || batchBusy}
              title="Push every local anchor file in /generated/anchors/ to Supabase Storage so URL-mode video models (Seedance/Wan/Grok) can fetch them. Idempotent."
              className="px-2 py-1 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-40">
              📤 Backfill to Storage
            </button>
            <span className="text-stone-300">·</span>
            <span className="text-stone-500 mr-1">density</span>
            <button type="button"
              onClick={() => setDensity((d) => (Math.max(0, d - 1) as Density))}
              disabled={density === 0}
              className="w-7 h-7 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-40 leading-none">−</button>
            <div className="w-12 text-center text-stone-500">
              {density === 4 ? 'fit row' : density === 3 ? 'packed' : density === 2 ? 'tight' : density === 1 ? 'med' : 'wide'}
            </div>
            <button type="button"
              onClick={() => setDensity((d) => (Math.min(4, d + 1) as Density))}
              disabled={density === 4}
              className="w-7 h-7 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-40 leading-none">+</button>
          </div>
        </div>
        <div
          className={`grid ${density >= 3 ? 'gap-2' : 'gap-4'}`}
          style={
            // density 4 = "fit row" — every anchor on one line, divide width evenly
            density === 4
              ? { gridTemplateColumns: `repeat(${anchors.length}, minmax(0, 1fr))` }
              : {
                  // auto-fit, minmax: grid fills full available width, cells stretch to fill,
                  // and the column count auto-reflows on window resize. Min width per cell
                  // is what determines the "ideal density" — when there's not enough room
                  // for another min-width cell, items wrap.
                  gridTemplateColumns: `repeat(auto-fit, minmax(${
                    density === 3 ? 110 : density === 2 ? 170 : density === 1 ? 240 : 360
                  }px, 1fr))`,
                }
          }
        >
          {anchors.map((a, idx) => {
            const file = activeAnchor(a.id);
            const fileUrl = file ? `/api/admin/gen/file?kind=anchor&name=${encodeURIComponent(file)}` : null;
            const ts = file?.match(/-(\d+)\.(png|jpe?g)$/)?.[1];
            const tsLabel = ts ? new Date(Number(ts) * 1000).toLocaleTimeString() : null;
            const history = anchorHistory[a.id] ?? [];
            const isOverride = !!anchorOverride[a.id] && anchorOverride[a.id] !== anchorFiles[a.id];
            const previous = history.find((f) => f !== file);
            const compact = density >= 2;
            const ultra = density >= 3;
            return (
              <div key={a.id} className={`border border-stone-200 rounded relative ${ultra ? 'p-1.5' : compact ? 'p-2' : 'p-3'}`}>
                <div className="flex items-center justify-between mb-1 gap-1">
                  <div className={`font-medium truncate ${ultra ? 'text-[10px]' : compact ? 'text-xs' : 'text-sm'}`}
                    title={a.label}>
                    {ultra ? `#${idx + 1}` : `#${idx + 1} · ${a.label}`}
                  </div>
                  {anchors.length > 2 && (
                    <button
                      type="button"
                      onClick={() => deleteAnchor(a.id)}
                      disabled={!!busy || batchBusy}
                      title="Delete anchor"
                      className="text-[10px] text-stone-400 hover:text-red-600 disabled:opacity-50"
                    >×</button>
                  )}
                </div>
                {fileUrl ? (
                  <a href={fileUrl} title="Open in popup (one window per image — reclick refocuses)"
                    onClick={(e) => {
                      e.preventDefault();
                      const winName = `rws-img-${(file ?? '').replace(/[^a-zA-Z0-9]/g, '_')}`;
                      const w = window.open(fileUrl, winName, 'popup,width=1280,height=800');
                      if (w) w.focus();
                    }}
                    className="relative block">
                    <img src={fileUrl} alt={a.id} className="w-full aspect-video object-cover rounded mb-1 bg-stone-100 hover:opacity-90 transition cursor-zoom-in" />
                    {(() => {
                      const d = anchorDims[a.id];
                      if (!d) return null;
                      const ratio = d.w / d.h;
                      const mismatch = Math.abs(ratio - SPEC_RATIO) / SPEC_RATIO > RATIO_TOLERANCE;
                      const labelRatio = (() => {
                        if (Math.abs(ratio - 16/9) < 0.01) return '16:9';
                        if (Math.abs(ratio - 9/16) < 0.01) return '9:16';
                        if (Math.abs(ratio - 1) < 0.01) return '1:1';
                        if (Math.abs(ratio - 4/3) < 0.01) return '4:3';
                        if (Math.abs(ratio - 3/2) < 0.01) return '3:2';
                        return ratio.toFixed(2);
                      })();
                      return (
                        <span
                          title={mismatch
                            ? `⚠ Aspect mismatch — anchor is ${d.w}×${d.h} (${labelRatio}), spec is ${ASPECT.width}×${ASPECT.height} (16:9). Re-render this anchor before using it for video, or every clip touching it inherits the wrong shape.`
                            : `${d.w}×${d.h} · ${labelRatio} (matches spec)`}
                          className={`absolute top-1 right-1 text-[9px] font-mono px-1.5 py-0.5 rounded ${
                            mismatch
                              ? 'bg-red-600 text-white ring-2 ring-red-300'
                              : 'bg-emerald-700/85 text-white'
                          }`}>
                          {mismatch ? '⚠ ' : ''}{d.w}×{d.h}
                        </span>
                      );
                    })()}
                  </a>
                ) : (
                  <div className="w-full aspect-video bg-stone-100 rounded mb-1 flex items-center justify-center text-xs text-stone-400">no image</div>
                )}
                {tsLabel && !compact && (
                  <div className="text-[10px] text-stone-500 mb-2 truncate" title={file}>
                    {isOverride ? <span className="text-amber-700">⏷ pinned</span> : 'last gen'}: {tsLabel} · <span className="font-mono">{file}</span>
                  </div>
                )}
                {history.length > 1 && !compact && (
                  <details className="mb-2">
                    <summary className="text-[11px] text-stone-600 cursor-pointer hover:text-stone-900">history ({history.length})</summary>
                    <div className="grid grid-cols-3 gap-1 mt-2">
                      {history.map((h) => {
                        const hUrl = `/api/admin/gen/file?kind=anchor&name=${encodeURIComponent(h)}`;
                        const hTs = h.match(/-(\d+)\.(png|jpe?g)$/)?.[1];
                        const hLabel = hTs ? new Date(Number(hTs) * 1000).toLocaleTimeString() : h;
                        const isActive = h === file;
                        return (
                          <button key={h} type="button"
                            onClick={() => setAnchorOverride((o) => ({ ...o, [a.id]: h }))}
                            className={`relative rounded overflow-hidden border-2 ${isActive ? 'border-amber-700' : 'border-stone-200 hover:border-stone-400'}`}
                            title={`Activate ${h}`}>
                            <img src={hUrl} alt={h} className="w-full aspect-video object-cover" />
                            <span className="absolute bottom-0 left-0 right-0 text-[9px] bg-black/60 text-white px-1 truncate">
                              {hLabel}{isActive ? ' ●' : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {isOverride && (
                      <button type="button"
                        onClick={() => setAnchorOverride((o) => { const n = { ...o }; delete n[a.id]; return n; })}
                        className="mt-2 text-[10px] text-stone-600 underline hover:text-stone-900">unpin (use latest)</button>
                    )}
                  </details>
                )}
                {!compact && (
                  <details className="mb-2">
                    <summary className="text-[11px] text-stone-600 cursor-pointer hover:text-stone-900">prompt</summary>
                    <div className="text-[11px] text-stone-700 mt-1 leading-snug whitespace-pre-wrap">{a.prompt}</div>
                  </details>
                )}
                <div className={`flex flex-wrap ${ultra ? 'gap-1' : 'gap-2'}`}>
                  <label
                    className={`border rounded cursor-pointer hover:bg-stone-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}
                    data-tooltip="Upload seed image" aria-label="Upload seed image">
                    {compact ? '⬆' : 'Upload'}
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadSeed(a.id, e.target.files[0])} />
                  </label>
                  <button type="button" onClick={() => genAnchor(a.id)} disabled={!!busy || batchBusy}
                    data-tooltip="Generate this anchor via Flux ($0.06)" aria-label="Generate via Flux"
                    className={`bg-amber-700 text-white rounded disabled:opacity-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>
                    {busy === `anchor-${a.id}` ? '…' : compact ? '✦' : 'Gen via Flux'}
                  </button>
                  <button type="button" onClick={refresh} disabled={!!busy || batchBusy}
                    data-tooltip="Re-poll generated/ for the latest file" aria-label="Refresh"
                    className={`border rounded hover:bg-stone-50 disabled:opacity-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>↻</button>
                  {previous && (
                    <button type="button"
                      onClick={() => setAnchorOverride((o) => ({ ...o, [a.id]: previous }))}
                      disabled={!!busy || batchBusy}
                      data-tooltip={`Revert to previous version (${previous})`} aria-label="Undo to previous"
                      className={`border rounded hover:bg-stone-50 disabled:opacity-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>↶</button>
                  )}
                  <button type="button" onClick={() => setInsertAt(idx)} disabled={!!busy || batchBusy}
                    data-tooltip="Insert an intermediate anchor after this one" aria-label="Insert intermediate anchor"
                    className={`border-2 border-dashed border-amber-500 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>
                    {compact ? '+' : '+ insert after'}
                  </button>
                  {(() => {
                    const d = anchorDims[a.id];
                    if (!d) return null;
                    const ratio = d.w / d.h;
                    const mismatch = Math.abs(ratio - SPEC_RATIO) / SPEC_RATIO > RATIO_TOLERANCE;
                    if (!mismatch) return null;
                    return (
                      <button type="button"
                        onClick={async () => {
                          setBusy(`normalize-${a.id}`);
                          try {
                            const r = await fetch('/api/admin/gen/normalize-anchor', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ anchorId: a.id }),
                            });
                            const j = await r.json();
                            if (!r.ok) {
                              append(`✗ crop ${a.id}: ${j.error ?? r.status}`, false);
                            } else {
                              append(`✂ ${a.id}: ${j.inputDims?.w}×${j.inputDims?.h} → ${j.outputDims.w}×${j.outputDims.h} (raw saved as ${j.rawPreservedAs})`, true);
                              await refresh();
                            }
                          } finally { setBusy(null); }
                        }}
                        disabled={!!busy || batchBusy}
                        title={`Center-crop + resize to ${ASPECT.width}×${ASPECT.height} (raw upload preserved on disk)`}
                        className={`border border-red-400 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 font-semibold ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>
                        {busy === `normalize-${a.id}` ? '…' : compact ? '✂' : '✂ Crop to spec'}
                      </button>
                    );
                  })()}
                </div>
                {progress && (progress.key === `anchor-${a.id}` || progress.key === `upload-${a.id}`) && (
                  <ProgressBar progress={progress} now={now} />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-8">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-3">
          <h2 className="text-2xl font-bold uppercase tracking-wide">
            2. Render Previews <span className="text-stone-500 font-normal text-base normal-case tracking-normal">({Object.keys(segmentFiles).length}/{segments.length} rendered · history accordion per tile)</span>
          </h2>
          <SpendInline />
        </div>
        {/* === TOP: Master player → Play Select Group band → B controls === */}
        {(() => {
          if (!spec) return null;
          const rendered = spec.segments
            .map((s, i) => ({ s, i, slot: segmentSlot(s), file: activeSegment(segmentSlot(s)) }))
            .filter((x) => x.file);
          if (!rendered.length) return null;
          const masterUrl = playlist?.[playlistIndex]?.url
            ?? `/api/admin/gen/file?kind=segment&name=${encodeURIComponent(rendered[0].file!)}`;
          const playingFile = playlist?.[playlistIndex]?.url;
          const includedCount = rendered.filter((r) => isPlayIncluded(r.slot)).length;
          const totalDur = rendered.reduce((acc, x) => acc + x.s.duration, 0);
          return (
            <div className="mb-6">
              {/* Master Player at top */}
              <MasterPlayer
                src={masterUrl}
                speed={playlist?.[playlistIndex]?.speed ?? 1}
                loop={!playlist}
                onProgress={setClipProgress}
                onEnded={playlist && !playlistEnded ? () => {
                  append(`▸ play: clip ${playlistIndex + 1}/${playlist.length} ended`);
                  setClipProgress(0);
                  if (playlistIndex + 1 < playlist.length) setPlaylistIndex((i) => i + 1);
                  else { append(`✓ play: finished ${playlist.length} segments`, true); setPlaylistEnded(true); }
                } : undefined}
              />
              {/* Play Select Group — proportional band, ALL rendered, explicit checkbox on left */}
              <div className="flex w-full h-9 rounded overflow-hidden border border-stone-300 bg-stone-100 mt-3 mb-2">
                {rendered.map(({ s, i, slot, file }) => {
                  const included = isPlayIncluded(slot);
                  const isPlaying = playingFile?.includes(encodeURIComponent(file!));
                  const playlistPos = playlist?.findIndex((p) => p.url.includes(encodeURIComponent(file!))) ?? -1;
                  const isPast = playlist != null && playlistPos !== -1 && playlistPos < playlistIndex;
                  const fillFrac = isPlaying ? clipProgress : isPast ? 1 : 0;
                  const widthPct = (s.duration / totalDur) * 100;
                  const onSegClick = () => { playOneSegment(i); };
                  return (
                    <button key={slot} type="button" onClick={onSegClick}
                      style={{ width: `${widthPct}%` }}
                      title={`seg ${i + 1} · ${s.duration}s${(segmentSpeed[slot] ?? 1) !== 1 ? ` @${segmentSpeed[slot]}x` : ''} · click anywhere → play this block · checkbox toggles play-queue inclusion`}
                      className={`relative h-full border-r border-stone-300 last:border-r-0 text-[10px] tabular-nums overflow-hidden flex items-center justify-center ${
                        isPlaying ? 'bg-amber-100' :
                        included ? 'bg-amber-50 hover:bg-amber-100' :
                        'bg-white hover:bg-stone-50 opacity-60'
                      }`}>
                      <span aria-hidden
                        className={`absolute left-0 top-0 bottom-0 ${isPlaying ? 'bg-amber-300/60' : 'bg-amber-200/50'} transition-[width] duration-100`}
                        style={{ width: `${fillFrac * 100}%` }} />
                      <span className="relative z-10 flex items-center gap-1.5 px-1">
                        <input type="checkbox" checked={included}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => togglePlayInclude(slot)}
                          className="cursor-pointer accent-amber-700 w-3 h-3"
                          title={included ? 'Uncheck to exclude from play queue' : 'Check to include in play queue'} />
                        <span className="font-medium">{i + 1}</span>
                        {(segmentSpeed[slot] ?? 1) !== 1 && (
                          <span className="text-[9px] text-amber-700">{(segmentSpeed[slot] ?? 1).toFixed(2)}x</span>
                        )}
                        {isPlaying && <span className="text-[9px] text-amber-700">▶</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* B controls — play-queue actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {playlist && (
                  <button type="button" onClick={() => { stopPlaylist(); setClipProgress(0); }}
                    className="px-2 py-1 border border-stone-400 rounded hover:bg-stone-50 text-xs">
                    ⏹ stop ({playlistIndex + 1}/{playlist.length}{playlistEnded ? ' ended' : ''})
                  </button>
                )}
                <button type="button" onClick={playSelected}
                  disabled={includedCount === 0}
                  title="Play all included segments through the master player in order"
                  className="px-3 py-1 bg-stone-800 text-white rounded disabled:opacity-50 text-xs">
                  ▶ Play Selected ({includedCount})
                </button>
                <button type="button" onClick={playIncludeAll}
                  title="Include all rendered segments in play queue"
                  className="px-2 py-0.5 border border-stone-300 rounded hover:bg-stone-50 text-xs">select all</button>
                <button type="button" onClick={playIncludeNone}
                  title="Exclude all from play queue"
                  className="px-2 py-0.5 border border-stone-300 rounded hover:bg-stone-50 text-xs">select none</button>
                <span className="text-[11px] uppercase tracking-wide text-stone-500 ml-1">play queue · click a segment to jump · checkbox toggles inclusion</span>
              </div>
            </div>
          );
        })()}
        {/* === BOTTOM: BATCH row → tile grid === */}
        {(() => {
          const selectedSegs = segments.filter((s) => selected[segmentSlot(s)]);
          const selCount = selectedSegs.length;
          const renderedSel = selectedSegs.filter((s) => activeSegment(segmentSlot(s)));
          const missingSel = selectedSegs.filter((s) => !activeSegment(segmentSlot(s)));
          const targetCount = skipRendered ? missingSel.length : selCount;
          const targetEst = (skipRendered ? missingSel : selectedSegs).reduce((acc, s) => acc + segmentCost(s), 0);
          return (
            <div className="mb-3 flex items-center gap-2 flex-wrap text-xs border border-stone-200 bg-stone-50 rounded p-2">
              <span className="font-medium uppercase tracking-wide text-stone-600">batch:</span>
              <button type="button" onClick={selectAll} className="px-2 py-0.5 border rounded hover:bg-white">select all</button>
              <button type="button" onClick={selectNone} className="px-2 py-0.5 border rounded hover:bg-white">select none</button>
              <button type="button" onClick={renderSelected} disabled={batchBusy || targetCount === 0}
                title={skipRendered && renderedSel.length > 0
                  ? `${renderedSel.length} of ${selCount} already rendered — skipping. Toggle "include re-renders" to force.`
                  : `Render ${targetCount} segments in parallel (~$${targetEst.toFixed(2)})`}
                className="px-3 py-1 bg-amber-700 text-white rounded disabled:opacity-50">
                {batchBusy
                  ? '… rendering…'
                  : skipRendered && renderedSel.length > 0
                    ? `▶ Render Missing (${missingSel.length} of ${selCount}) — est $${targetEst.toFixed(2)}`
                    : `▶ Render Selected (${targetCount}) — est $${targetEst.toFixed(2)}`}
              </button>
              {batchBusy && (
                <button type="button" onClick={abortBatch}
                  title="Abort in-flight batch — closes the client connection. In-flight provider jobs may still complete and bill."
                  className="px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800">
                  ⏹ Stop
                </button>
              )}
              <label className="flex items-center gap-1 cursor-pointer ml-1" title="When OFF, Render Selected re-renders even segments you've already rendered. When ON (default), already-rendered segments are skipped.">
                <input type="checkbox" checked={!skipRendered} onChange={(e) => setSkipRendered(!e.target.checked)}
                  className="cursor-pointer accent-amber-700" />
                <span className="text-stone-700">include re-renders</span>
              </label>
            </div>
          );
        })()}
        <div
          className={`grid ${density >= 3 ? 'gap-2' : 'gap-4'}`}
          style={
            density === 4
              ? { gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }
              : { gridTemplateColumns: `repeat(auto-fit, minmax(${density === 3 ? 110 : density === 2 ? 170 : density === 1 ? 240 : 360}px, 1fr))` }
          }
        >
          {segments.map((s, i) => {
            const slot = segmentSlot(s);
            const file = activeSegment(slot);
            const fileUrl = file ? `/api/admin/gen/file?kind=segment&name=${encodeURIComponent(file)}` : null;
            const ts = file?.match(/-(\d+)\.(mp4|webm|mov)$/)?.[1];
            const tsLabel = ts ? new Date(Number(ts)).toLocaleTimeString() : null;
            const history = segmentHistory[slot] ?? [];
            const ovActive = !!segmentOverride[slot] && segmentOverride[slot] !== segmentFiles[slot];
            const compact = density >= 2;
            const ultra = density >= 3;
            return (
              <div key={`render-${slot}-${i}`} className={`border rounded relative ${selected[slot] ? 'border-amber-600 ring-1 ring-amber-300' : 'border-stone-200'} ${ultra ? 'p-1.5' : compact ? 'p-2' : 'p-3'}`}>
                <button type="button" onClick={() => toggleSelect(slot)}
                  title={`Click anywhere to ${selected[slot] ? 'deselect' : 'select'} — ${s.startAnchor} → ${s.endAnchor}`}
                  className={`flex items-center justify-between mb-1 gap-1 w-full text-left rounded px-1 -mx-1 py-0.5 ${selected[slot] ? 'bg-amber-100/60 hover:bg-amber-100' : 'hover:bg-stone-100'}`}>
                  <span className={`flex items-center gap-1 font-medium truncate ${ultra ? 'text-[10px]' : compact ? 'text-xs' : 'text-sm'}`}>
                    <input type="checkbox" checked={!!selected[slot]} readOnly tabIndex={-1}
                      className="accent-amber-700 pointer-events-none" />
                    {ultra ? `${i + 1}` : `seg ${i + 1} · ${s.startAnchor}→${s.endAnchor}`}
                  </span>
                  {ovActive && <span className="text-[9px] text-amber-700 shrink-0" title="Pinned to history entry">⏷</span>}
                  {(() => {
                    const sd = anchorDims[s.startAnchor];
                    const ed = anchorDims[s.endAnchor];
                    const startBad = sd && Math.abs((sd.w / sd.h) - SPEC_RATIO) / SPEC_RATIO > RATIO_TOLERANCE;
                    const endBad = ed && Math.abs((ed.w / ed.h) - SPEC_RATIO) / SPEC_RATIO > RATIO_TOLERANCE;
                    if (!startBad && !endBad) return null;
                    const which = startBad && endBad ? 'start+end' : startBad ? 'start' : 'end';
                    return <span className="text-[9px] font-bold text-red-700 shrink-0"
                      title={`⚠ ${which}-anchor aspect doesn't match spec (${ASPECT.width}×${ASPECT.height}). Output clip will inherit the mismatched shape. Re-render the offending anchor first.`}>⚠</span>;
                  })()}
                </button>
                {(() => {
                  const startAnchorFile = activeAnchor(s.startAnchor);
                  const posterUrl = startAnchorFile
                    ? `/api/admin/gen/file?kind=anchor&name=${encodeURIComponent(startAnchorFile)}`
                    : undefined;
                  if (fileUrl) {
                    return (
                      <SegmentTileVideo src={fileUrl} poster={posterUrl} speed={segmentSpeed[slot] ?? 1} onClickPlay={() => playOneSegment(i)} />
                    );
                  }
                  if (posterUrl) {
                    return (
                      <div className="w-full aspect-video rounded mb-1 bg-black relative overflow-hidden">
                        <img src={posterUrl} alt={`${s.startAnchor} poster`}
                          className="w-full h-full object-cover opacity-70" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[10px] text-white/90 bg-black/40 px-2 py-0.5 rounded uppercase tracking-wide">
                            not yet rendered
                          </span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="w-full aspect-video bg-stone-100 rounded mb-1 flex items-center justify-center text-xs text-stone-400 border border-dashed border-stone-300">
                      no anchor
                    </div>
                  );
                })()}
                {tsLabel && !compact && (
                  <div className="text-[10px] text-stone-500 mb-1 truncate" title={file}>
                    {ovActive ? <span className="text-amber-700">⏷ pinned</span> : 'last render'}: {tsLabel} · {s.duration}s {s.mode ?? 'std'} · ${segmentCost(s).toFixed(2)}
                  </div>
                )}
                {history.length > 1 && (
                  <details className="mb-1">
                    <summary className={`cursor-pointer hover:text-stone-900 ${ultra ? 'text-[10px]' : 'text-[11px]'} text-stone-600`}>
                      ▾ history ({history.length})
                    </summary>
                    <div className="flex flex-col gap-1 mt-2" role="radiogroup" aria-label={`Active render version for segment ${i + 1}`}>
                      {history.map((h) => {
                        const hUrl = `/api/admin/gen/file?kind=segment&name=${encodeURIComponent(h)}`;
                        const hTs = h.match(/-(\d+)\.(mp4|webm|mov)$/)?.[1];
                        const hLabel = hTs ? new Date(Number(hTs)).toLocaleTimeString() : h;
                        const isActive = h === file;
                        return (
                          <div key={h}
                            className={`flex items-center gap-2 rounded border px-1 py-1 ${isActive ? 'border-amber-600 bg-amber-50' : 'border-stone-200 hover:border-stone-400 hover:bg-stone-50'}`}>
                            <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer" title={`Use this render (${h})`}>
                              <input type="radio" name={`hist-${slot}`}
                                checked={isActive}
                                onChange={() => setSegmentOverride((o) => ({ ...o, [slot]: h }))}
                                className="accent-amber-700 cursor-pointer shrink-0" />
                              <video src={hUrl} className="w-12 aspect-video object-cover bg-black rounded shrink-0" muted preload="metadata" />
                              <span className="text-[10px] text-stone-700 truncate">{hLabel}{isActive ? ' ●' : ''}</span>
                            </label>
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); archiveSegment(slot, h); }}
                              title="Archive this render — file stays on disk, hidden from history. Restore from Archive Bin."
                              className="text-stone-400 hover:text-red-700 text-[12px] leading-none px-1">🗑</button>
                          </div>
                        );
                      })}
                    </div>
                    {ovActive && (
                      <button type="button"
                        onClick={() => setSegmentOverride((o) => { const n = { ...o }; delete n[slot]; return n; })}
                        className="mt-2 text-[10px] text-stone-600 underline hover:text-stone-900">unpin (use latest)</button>
                    )}
                  </details>
                )}
                <div className={`flex flex-wrap items-center ${ultra ? 'gap-1' : 'gap-2'}`}>
                  <button type="button" onClick={() => genSegment(i)} disabled={!!busy || batchBusy || !anchorFiles[s.startAnchor]}
                    data-tooltip={`Render segment ${i + 1} ($${segmentCost(s).toFixed(2)})`} aria-label="Render segment"
                    className={`bg-amber-700 text-white rounded disabled:opacity-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>
                    {busy === `segment-${slot}` ? '…' : file ? (compact ? '↻' : 'Re-render') : (compact ? '✦' : 'Render')}
                  </button>
                  {file && (
                    <div className="flex items-center gap-0.5 border border-stone-300 rounded bg-white" title="Playback speed (applies to inline tile + Play Selected)">
                      <button type="button" onClick={() => nudgeSegmentSpeed(slot, -0.05)}
                        className="px-1 hover:bg-stone-100 leading-none text-stone-600">−</button>
                      <span className={`tabular-nums ${ultra ? 'text-[9px] px-0.5' : 'text-[10px] px-1'} ${(segmentSpeed[slot] ?? 1) !== 1 ? 'text-amber-700 font-semibold' : 'text-stone-700'}`}>
                        {(segmentSpeed[slot] ?? 1).toFixed(2)}x
                      </span>
                      <button type="button" onClick={() => nudgeSegmentSpeed(slot, 0.05)}
                        className="px-1 hover:bg-stone-100 leading-none text-stone-600">+</button>
                    </div>
                  )}
                  <button type="button" onClick={() => reassessSegment(i)}
                    disabled={!!busy || batchBusy || reassessBusy === i || !anchorFiles[s.startAnchor] || !anchorFiles[s.endAnchor]}
                    data-tooltip="Predict transition smoothness + suggest tighter prompt"
                    aria-label="Reassess transition"
                    className={`border rounded hover:bg-stone-50 disabled:opacity-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>
                    {reassessBusy === i ? '…' : '✨'}
                  </button>
                  {history.length > 0 && (() => {
                    const previous = history.find((h) => h !== file);
                    if (!previous) return null;
                    return (
                      <button type="button"
                        onClick={() => setSegmentOverride((o) => ({ ...o, [slot]: previous }))}
                        disabled={!!busy || batchBusy}
                        data-tooltip={`Revert to previous render (${previous})`} aria-label="Undo to previous"
                        className={`border rounded hover:bg-stone-50 disabled:opacity-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>↶</button>
                    );
                  })()}
                  {file && (
                    <button type="button"
                      onClick={() => archiveSegment(slot, file)}
                      disabled={!!busy || batchBusy}
                      data-tooltip="Archive this render (kept in Archive Bin, file not deleted)" aria-label="Archive render"
                      className={`border border-stone-300 rounded hover:bg-red-50 hover:border-red-400 hover:text-red-700 disabled:opacity-50 ${ultra ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-1'}`}>🗑</button>
                  )}
                </div>
                {progress && progress.key === `segment-${slot}` && <ProgressBar progress={progress} now={now} />}
              </div>
            );
          })}
        </div>
        {/* Archive Bin — collapsible, restore any archived render to any slot */}
        {archive.length > 0 && (
          <div className="mt-6 border border-stone-200 rounded">
            <button type="button" onClick={() => setArchiveOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs uppercase tracking-wide text-stone-700 hover:bg-stone-50">
              <span>🗑 Archive Bin <span className="font-normal normal-case text-stone-500">({archive.length} item{archive.length === 1 ? '' : 's'})</span></span>
              <span className="text-stone-400">{archiveOpen ? '▴' : '▾'}</span>
            </button>
            {archiveOpen && (
              <div className="p-3 border-t border-stone-200 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {archive.map((row) => {
                  const url = `/api/admin/gen/file?kind=segment&name=${encodeURIComponent(row.filename)}`;
                  const tsMatch = row.filename.match(/-(\d+)\.(mp4|webm|mov)$/);
                  const tsLabel = tsMatch ? new Date(Number(tsMatch[1])).toLocaleString() : row.filename;
                  return (
                    <div key={row.filename} className="border border-stone-200 rounded p-2 flex flex-col gap-1.5 bg-stone-50">
                      <video src={url} className="w-full aspect-video object-cover bg-black rounded" muted controls preload="metadata" />
                      <div className="text-[10px] text-stone-600 truncate" title={row.filename}>{tsLabel}</div>
                      <div className="text-[10px] text-stone-500 truncate" title={`originally slot: ${row.slot}`}>from: <span className="font-mono">{row.slot}</span></div>
                      <div className="flex items-center gap-1">
                        <select
                          defaultValue={row.slot}
                          onChange={(e) => { (e.currentTarget.dataset.target = e.currentTarget.value); }}
                          data-target={row.slot}
                          className="text-[10px] border border-stone-300 rounded px-1 py-0.5 bg-white flex-1 min-w-0"
                          title="Restore destination slot">
                          {segments.map((seg, i) => {
                            const sk = segmentSlot(seg);
                            return <option key={sk} value={sk}>seg {i + 1} · {seg.startAnchor}→{seg.endAnchor}</option>;
                          })}
                        </select>
                        <button type="button"
                          onClick={(e) => {
                            const sel = (e.currentTarget.parentElement?.querySelector('select') as HTMLSelectElement | null);
                            const target = sel?.value ?? row.slot;
                            unarchiveSegment(row.filename, target);
                          }}
                          title="Restore — un-archive and pin to selected slot"
                          className="text-[10px] px-2 py-0.5 border border-emerald-600 text-emerald-700 rounded hover:bg-emerald-50">
                          ↩ restore
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-bold uppercase tracking-wide mb-3">
          3. Video Segments <span className="text-stone-500 font-normal text-base normal-case tracking-normal">({segments.length} segments ≈ {totalDuration}s · {Object.keys(segmentFiles).length}/{segments.length} rendered)</span>
        </h2>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
          {segments.map((s, i) => {
            const slot = segmentSlot(s);
            const file = activeSegment(slot);
            const startReady = !!anchorFiles[s.startAnchor];
            return (
              <div key={`${slot}-${i}`} className="flex flex-col gap-1.5 border border-stone-200 rounded p-2">
                <div className="flex items-start gap-2">
                  <div className="w-5 text-center font-semibold shrink-0 text-xs leading-5">{i + 1}</div>
                  <div className="flex-1 text-xs min-w-0">
                    <div className="flex items-center gap-1">
                      <div className="font-medium truncate text-stone-800 flex-1" title={`${s.startAnchor} → ${s.endAnchor}`}>{s.startAnchor} → {s.endAnchor}</div>
                      <button type="button"
                        onClick={() => setEditingPrompt(editingPrompt === i ? null : i)}
                        data-tooltip="Edit prompt (with history)"
                        aria-label="Edit prompt"
                        className="text-stone-400 hover:text-amber-700 text-xs leading-none px-1">
                        {editingPrompt === i ? '✕' : '✎'}
                      </button>
                    </div>
                    {editingPrompt === i ? (
                      <PromptEditor
                        segmentIndex={i}
                        current={s.prompt}
                        history={s.promptHistory ?? []}
                        onSave={(next) => { setSegmentPrompt(i, next); setEditingPrompt(null); }}
                        onCancel={() => setEditingPrompt(null)}
                      />
                    ) : (
                      <div className="text-[11px] text-stone-600 leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.prompt}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <select
                      value={s.duration}
                      onChange={(e) => setSegmentDuration(i, Number(e.target.value) as 5 | 10)}
                      disabled={!!busy || batchBusy}
                      data-tooltip="Kling i2v clip length"
                      className="border border-stone-300 rounded px-1 py-0.5 text-[11px] bg-white text-stone-900 w-16"
                    >
                      <option value={5}>5s</option>
                      <option value={10}>10s</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <select
                        value={s.mode ?? 'std'}
                        onChange={(e) => setSegmentMode(i, e.target.value as 'std' | 'pro')}
                        disabled={!!busy || batchBusy}
                        data-tooltip={`std = $0.042/s · pro = $0.07/s · this segment = $${segmentCost(s).toFixed(2)}`}
                        className="border border-stone-300 rounded px-1 py-0.5 text-[11px] bg-white text-stone-900 w-16"
                      >
                        <option value="std">std</option>
                        <option value="pro">pro</option>
                      </select>
                      <span className="text-[10px] text-stone-400 tabular-nums" title="Estimated render cost">${segmentCost(s).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => genSegment(i)}
                        disabled={!!busy || batchBusy || !startReady}
                        data-tooltip={`Render this segment ($${segmentCost(s).toFixed(2)}) — output appears in row 2`}
                        className="text-[11px] px-2 py-1 bg-amber-700 text-white rounded disabled:opacity-50">
                        {busy === `segment-${slot}` ? '…' : file ? 'Regen' : 'Gen'}
                      </button>
                      <button type="button"
                        onClick={() => reassessSegment(i)}
                        disabled={!!busy || batchBusy || reassessBusy === i || !anchorFiles[s.startAnchor] || !anchorFiles[s.endAnchor]}
                        data-tooltip="Predict transition smoothness + suggest tighter prompt"
                        aria-label="Rewrite via reassess"
                        className="text-[11px] px-2 py-1 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-50">
                        {reassessBusy === i ? '✨…' : '✨ Rewrite'}
                      </button>
                    </div>
                  </div>
                </div>
                {progress && progress.key === `segment-${slot}` && (
                  <ProgressBar progress={progress} now={now} />
                )}
                {assessments[i] && (
                  <div className={`w-full mt-2 p-2 rounded border text-xs ${
                    assessments[i].severity === 'good' ? 'bg-emerald-50 border-emerald-200' :
                    assessments[i].severity === 'marginal' ? 'bg-amber-50 border-amber-200' :
                    'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-semibold uppercase tracking-wide text-[10px]">
                        {assessments[i].severity === 'good' ? '✓ smooth' : assessments[i].severity === 'marginal' ? '⚠ marginal' : '✗ jumpy'}
                      </div>
                      <button type="button"
                        onClick={() => setAssessments((a) => { const n = { ...a }; delete n[i]; return n; })}
                        className="text-[10px] text-stone-500 hover:text-stone-900">dismiss</button>
                    </div>
                    <div className="text-stone-700 mb-1">{assessments[i].summary}</div>
                    {assessments[i].issues?.length > 0 && (
                      <ul className="list-disc pl-4 text-stone-600 mb-2 space-y-0.5">
                        {assessments[i].issues.map((iss, k) => <li key={k}>{iss}</li>)}
                      </ul>
                    )}
                    {assessments[i].suggestedPrompt && (
                      <details className="mt-1">
                        <summary className="text-[11px] font-medium text-stone-700 cursor-pointer hover:text-stone-900">
                          suggested prompt rewrite
                        </summary>
                        <div className="mt-1 p-2 bg-white border border-stone-200 rounded text-stone-700 leading-snug whitespace-pre-wrap">
                          {assessments[i].suggestedPrompt}
                        </div>
                        <button type="button"
                          onClick={() => { setSegmentPrompt(i, assessments[i].suggestedPrompt); setAssessments((a) => { const n = { ...a }; delete n[i]; return n; }); }}
                          disabled={!!busy || batchBusy}
                          className="mt-1 text-[11px] px-2 py-1 bg-amber-700 text-white rounded hover:bg-amber-800 disabled:opacity-50">
                          Apply suggested prompt
                        </button>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-8 grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        {(() => {
          const errors = log.filter((l) => l.ok === false);
          const lastError = errors[errors.length - 1];
          const showError = lastError && lastError.ts > errorAckedAt;
          return (
            <div>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h2 className="text-base font-medium flex items-center gap-2">
                  Log
                  <span className="text-xs text-stone-500 font-normal">({log.length} lines · newest first · persisted to Supabase)</span>
                  {errors.length > 0 && (
                    <span
                      className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-300 font-mono"
                      title={lastError?.msg}
                    >
                      [error × {errors.length}]
                    </span>
                  )}
                </h2>
                <button type="button" onClick={archiveLog}
                  data-tooltip="Hide current entries from view (still kept in Supabase forever — see ?showArchived=1)"
                  className="text-xs px-2 py-1 border rounded hover:bg-stone-50">📦 Archive</button>
              </div>
              {showError && lastError && (
                <div className="mb-3 border border-red-300 bg-red-50 text-red-900 text-xs p-2 rounded font-mono flex items-start gap-2">
                  <div className="flex-1">
                    <strong>last error</strong> [{new Date(lastError.ts).toLocaleTimeString()}] {lastError.msg}
                  </div>
                  <button type="button"
                    onClick={() => setErrorAckedAt(lastError.ts)}
                    title="Acknowledge — hide this error banner (it stays in the log)"
                    className="text-red-700 hover:text-red-900 hover:bg-red-100 rounded px-1.5 leading-none text-base shrink-0">
                    ×
                  </button>
                </div>
              )}
              {progress && (
                <div className="mb-3 border border-amber-200 bg-amber-50 rounded p-2">
                  <ProgressBar progress={progress} now={now} />
                </div>
              )}
              <pre className="bg-stone-900 text-stone-100 text-xs p-3 rounded h-48 overflow-auto">
{[...log].reverse().map((l) => `${l.ok === false ? '✗ ' : ''}[${new Date(l.ts).toLocaleTimeString()}] ${l.msg}`).join('\n')}
              </pre>
            </div>
          );
        })()}
        <div>
          <h2 className="text-base font-medium mb-3 flex items-center gap-2">
            Batch Spend <span className="text-xs text-stone-500 font-normal">({batchSpend.length} runs)</span>
          </h2>
          <div className="bg-stone-50 border border-stone-200 text-xs p-2 rounded h-48 overflow-auto font-mono">
            {batchSpend.length === 0
              ? <div className="text-stone-400 italic">no batch renders yet — select segments + click Render Selected</div>
              : batchSpend.map((b) => (
                <div key={b.ts} className="mb-1 pb-1 border-b border-stone-200 last:border-b-0">
                  <div className="text-stone-700">
                    [{new Date(b.ts).toLocaleTimeString()}] segs {b.segLabels.join(',')} → {b.ok}✓ {b.err > 0 && <span className="text-red-700">{b.err}✗</span>}
                  </div>
                  <div className="text-stone-500">
                    {b.cost != null ? <span className="text-stone-900">${b.cost.toFixed(4)} measured</span> : <span>~${b.estimate.toFixed(2)} est</span>}
                    {b.cost != null && <span className="text-stone-400"> (est ${b.estimate.toFixed(2)})</span>}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </section>

      {(() => {
        if (preview.closed) return null;
        const playing = playlist?.[playlistIndex];
        const previewUrl = playing?.url
          ?? (stitchedFile ? `/api/admin/gen/file?kind=loop&name=${encodeURIComponent(stitchedFile)}` : null);
        if (!previewUrl) return null;
        const playingSpeed = playing?.speed ?? preview.speed;
        const label = playing
          ? `${playing.label} (${playlistIndex + 1}/${playlist!.length})${playingSpeed !== 1 ? ` @${playingSpeed}x` : ''}${playlistEnded ? ' · ended' : ''}`
          : 'stitched loop';
        const stale = !playlist && lastStitchAt != null && lastSegmentChangeAt > lastStitchAt;
        if (preview.minimized) {
          return (
            <button type="button"
              onClick={() => setPreview((p) => ({ ...p, minimized: false }))}
              className="fixed bottom-4 right-4 z-50 bg-amber-700 text-white text-xs px-3 py-2 rounded shadow-lg hover:bg-amber-800">
              ▸ preview {playing ? `· ${label}` : ''}
            </button>
          );
        }
        return (
          <FloatingPreview
            fileUrl={previewUrl}
            label={label}
            stale={stale}
            state={preview}
            speed={playingSpeed}
            onChange={(next) => setPreview((p) => ({ ...p, ...next }))}
            onClose={() => setPreview((p) => ({ ...p, closed: true }))}
            onEnded={playlist && !playlistEnded ? () => {
              append(`▸ play: clip ${playlistIndex + 1}/${playlist.length} ended`);
              if (playlistIndex + 1 < playlist.length) {
                setPlaylistIndex((i) => i + 1);
              } else {
                append(`✓ play: finished ${playlist.length} segments — last clip stays in PIP, click ⏹ stop or × to clear`, true);
                setPlaylistEnded(true);
              }
            } : undefined}
          />
        );
      })()}

      {insertAt !== null && spec && (() => {
        const before = spec.anchors[insertAt];
        const after = spec.anchors[(insertAt + 1) % spec.anchors.length];
        // BRIDGE_SUGGESTIONS keys use raw ids; underscores in ids become double_underscores so we normalise here
        const key = `${before.id.replace(/-/g, '_')}__${after.id.replace(/-/g, '_')}`;
        const presets = BRIDGE_SUGGESTIONS[key] ?? BRIDGE_SUGGESTIONS[`${before.id}__${after.id}`] ?? [];
        return (
          <InsertDialog
            before={before}
            after={after}
            presets={presets}
            onCancel={() => setInsertAt(null)}
            onSubmit={(label, prompt) => insertAnchor(insertAt, label, prompt)}
          />
        );
      })()}
    </div>
  );
}

function InsertDialog({
  before, after, presets, onCancel, onSubmit,
}: {
  before: SpecAnchor;
  after: SpecAnchor;
  presets: BridgePreset[];
  onCancel: () => void;
  onSubmit: (label: string, prompt: string) => void;
}) {
  const defaultLabel = `${before.id} → ${after.id} bridge`;
  const defaultPrompt = `Transitional intermediate frame between two scenes. Scene A: ${before.label}. Scene B: ${after.label}. Blend the dominant colors, lighting, and atmosphere of both scenes evenly. Painterly, cinematic, dreamlike, no people, no text, 16:9 widescreen. Composition should feel like a natural midpoint that could fade smoothly from A and into B.`;
  // If we have curated presets, start with the first one applied
  const initial = presets[0];
  const [label, setLabel] = useState(initial?.label ?? defaultLabel);
  const [prompt, setPrompt] = useState(initial?.prompt ?? defaultPrompt);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white text-stone-900 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-auto">
        <h3 className="text-lg font-semibold mb-1">Insert intermediate anchor</h3>
        <p className="text-xs text-stone-600 mb-4">
          Inserting between <strong>#{before.id}</strong> and <strong>#{after.id}</strong>. The loop becomes longer; segments touching this position will be regenerated as <em>before → new</em> and <em>new → after</em>.
        </p>
        {presets.length > 0 && (
          <div className="mb-4 p-3 border border-amber-200 bg-amber-50 rounded">
            <div className="text-xs font-medium text-amber-900 mb-2">Suggested bridges for this transition:</div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button key={p.label} type="button"
                  onClick={() => { setLabel(p.label); setPrompt(p.prompt); }}
                  className="text-xs px-2 py-1 border border-amber-400 bg-white rounded hover:bg-amber-100">
                  {p.label}
                </button>
              ))}
              <button type="button"
                onClick={() => { setLabel(defaultLabel); setPrompt(defaultPrompt); }}
                className="text-xs px-2 py-1 border border-stone-300 bg-white rounded hover:bg-stone-50">
                generic blend
              </button>
            </div>
          </div>
        )}
        <label className="block mb-3">
          <span className="block text-xs font-medium mb-1">Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            className="w-full text-sm border border-stone-300 rounded px-2 py-1.5 bg-white text-stone-900" />
        </label>
        <label className="block mb-4">
          <span className="block text-xs font-medium mb-1">Anchor prompt (sent to Flux when you click Gen)</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            className="w-full text-xs border border-stone-300 rounded px-2 py-1.5 font-mono leading-relaxed bg-white text-stone-900" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 border rounded hover:bg-stone-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(label.trim(), prompt.trim())}
            disabled={!label.trim() || !prompt.trim()}
            className="text-sm px-3 py-1.5 bg-amber-700 text-white rounded disabled:opacity-50">
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptEditor({
  segmentIndex, current, history, onSave, onCancel,
}: {
  segmentIndex: number;
  current: string;
  history: PromptHistoryEntry[];
  onSave: (prompt: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(current);
  const dirty = draft.trim() !== current.trim();
  return (
    <div className="mt-1 border border-amber-300 rounded bg-amber-50/40 p-2 space-y-2">
      {history.length > 0 && (
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] uppercase tracking-wide text-stone-500 shrink-0">history</label>
          <select
            defaultValue=""
            onChange={(e) => {
              const ts = Number(e.target.value);
              if (!ts) return;
              const entry = history.find((h) => h.ts === ts);
              if (entry) setDraft(entry.prompt);
              e.target.value = '';
            }}
            className="flex-1 text-[11px] border border-stone-300 rounded px-1 py-0.5 bg-white text-stone-900"
          >
            <option value="">▾ load past version ({history.length})</option>
            {history.map((h) => {
              const label = new Date(h.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              const preview = h.prompt.replace(/\s+/g, ' ').slice(0, 60);
              return <option key={h.ts} value={h.ts}>{label} — {preview}{h.prompt.length > 60 ? '…' : ''}</option>;
            })}
          </select>
        </div>
      )}
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
        rows={6}
        aria-label={`Edit prompt for segment ${segmentIndex + 1}`}
        className="w-full text-[11px] border border-stone-300 rounded px-2 py-1.5 font-mono leading-relaxed bg-white text-stone-900" />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel}
          className="text-[11px] px-2 py-1 border border-stone-300 rounded hover:bg-white">Cancel</button>
        <button type="button" onClick={() => onSave(draft.trim())}
          disabled={!draft.trim() || !dirty}
          className="text-[11px] px-2 py-1 bg-amber-700 text-white rounded disabled:opacity-50">
          Save
        </button>
      </div>
    </div>
  );
}

type FloatingPreviewState = { x: number; y: number; w: number; opacity: number; minimized: boolean; playing: boolean; speed: number; closed: boolean; loop: boolean };
function FloatingPreview({
  fileUrl, label, stale, state, speed, onChange, onEnded, onClose,
}: {
  fileUrl: string;
  label?: string;
  stale: boolean;
  state: FloatingPreviewState;
  speed?: number;
  onChange: (next: Partial<FloatingPreviewState>) => void;
  onEnded?: () => void;
  onClose?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [dragging, setDragging] = useState<null | 'move' | 'resize'>(null);
  const dragStart = useRef<{ mx: number; my: number; sx: number; sy: number; sw: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      if (!dragStart.current) return;
      const { mx, my, sx, sy, sw } = dragStart.current;
      if (dragging === 'move') {
        const dx = e.clientX - mx;
        const dy = e.clientY - my;
        // x/y stored as DISTANCE FROM RIGHT/BOTTOM so panel stays in-frame on scroll/resize.
        onChange({ x: Math.max(0, sx - dx), y: Math.max(0, sy - dy) });
      } else {
        // resize from top-left corner: dragging up-left increases width
        const dw = (mx - e.clientX);
        onChange({ w: Math.max(180, Math.min(900, sw + dw)) });
      }
    }
    function onUp() { setDragging(null); dragStart.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, onChange]);

  function startMove(e: React.MouseEvent) {
    dragStart.current = { mx: e.clientX, my: e.clientY, sx: state.x, sy: state.y, sw: state.w };
    setDragging('move');
  }
  function startResize(e: React.MouseEvent) {
    e.stopPropagation();
    dragStart.current = { mx: e.clientX, my: e.clientY, sx: state.x, sy: state.y, sw: state.w };
    setDragging('resize');
  }
  const effectiveSpeed = speed ?? state.speed ?? 1;

  // Whenever src changes: force Chrome to actually load the new clip + autoplay.
  // (React updates the src attribute, but Chrome doesn't always restart playback
  // mid-stream without an explicit .load() call.) v.load() does NOT detach an
  // existing PiP session — the element keeps that binding and Chrome streams the
  // new media into the PiP window.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;
    v.load();
    const play = () => {
      if (cancelled) return;
      v.playbackRate = effectiveSpeed;
      v.play().catch(() => { /* autoplay block — user can hit ▶ */ });
    };
    v.addEventListener('loadedmetadata', play, { once: true });
    return () => { cancelled = true; v.removeEventListener('loadedmetadata', play); };
  }, [fileUrl, effectiveSpeed]);

  // Manual play/pause toggle from the header button.
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  // PiP / Fullscreen: SYNCHRONOUS calls inside the click handler. Chrome
  // requires the user-gesture chain be intact when requestPictureInPicture()
  // / requestFullscreen() are called — no awaits before either.
  function enterPip() {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement === v) return;
    if (document.fullscreenElement === v) document.exitFullscreen().catch(() => {});
    if (v.readyState < 1) {
      console.warn('[preview] PiP requested before metadata; press ▶ first.');
      return;
    }
    v.requestPictureInPicture().catch((e: unknown) => console.warn('[preview] PiP failed:', e));
  }
  function enterFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement === v) return;
    if (document.pictureInPictureElement === v) document.exitPictureInPicture().catch(() => {});
    v.requestFullscreen().catch((e: unknown) => console.warn('[preview] fullscreen failed:', e));
  }

  return (
    <div
      className="fixed z-50 shadow-2xl rounded-lg overflow-hidden border border-stone-300 bg-white"
      style={{ right: state.x, bottom: state.y, width: state.w, opacity: state.opacity }}
    >
      <div onMouseDown={startMove}
        className="cursor-move bg-stone-900 text-white text-[11px] px-2 py-1 flex items-center gap-2 select-none">
        <span className="opacity-70">⋮⋮</span>
        <span className="font-medium">Preview</span>
        {label && <span className="opacity-70 truncate max-w-[16ch]" title={label}>{label}</span>}
        {stale && <span className="text-amber-300">⚠ stale</span>}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1" title="Opacity">
            <span className="opacity-60">◐</span>
            <input type="range" min={0.2} max={1} step={0.05}
              value={state.opacity}
              onChange={(e) => onChange({ opacity: Number(e.target.value) })}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-16" />
          </label>
          <select
            value={effectiveSpeed}
            onChange={(e) => onChange({ speed: Number(e.target.value) })}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            title="Playback speed (per-clip overrides if set on segment tile)"
            className="text-[10px] bg-white/10 hover:bg-white/20 border border-white/20 rounded px-1 py-0.5 cursor-pointer">
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
              <option key={s} value={s} className="text-stone-900">{s}x</option>
            ))}
          </select>
          <button type="button" onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="px-1.5 hover:bg-white/10 rounded">{state.playing ? '⏸' : '▶'}</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange({ loop: !state.loop }); }}
            title={state.loop ? 'Loop ON — repeat current clip indefinitely' : 'Loop OFF — advance through playlist'}
            className={`px-1.5 rounded ${state.loop ? 'bg-amber-500 text-stone-900' : 'hover:bg-white/10'}`}>↻</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); enterPip(); }}
            title="Open in browser-native Picture-in-Picture window"
            className="px-1.5 hover:bg-white/10 rounded">📺</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); enterFullscreen(); }}
            title="Fullscreen"
            className="px-1.5 hover:bg-white/10 rounded">⛶</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange({ minimized: true }); }}
            title="Minimize"
            className="px-1.5 hover:bg-white/10 rounded">_</button>
          {onClose && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }}
              title="Close preview"
              className="px-1.5 hover:bg-white/10 rounded">×</button>
          )}
        </div>
      </div>
      <video ref={videoRef} src={fileUrl}
        className="w-full block bg-black"
        style={{ aspectRatio: '16/9' }}
        muted playsInline preload="auto" autoPlay
        loop={state.loop}
        onPlay={() => onChange({ playing: true })}
        onPause={() => onChange({ playing: false })}
        onEnded={state.loop ? undefined : onEnded} />
      <div onMouseDown={startResize}
        className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize bg-amber-500/80 hover:bg-amber-600"
        title="Drag to resize" />
    </div>
  );
}

function SegmentTileVideo({ src, poster, speed, onClickPlay }: {
  src: string; poster?: string; speed: number; onClickPlay?: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (v) v.playbackRate = speed;
  }, [speed, src]);
  return (
    <button type="button" onClick={onClickPlay}
      title="Click to play this segment in the floating preview"
      className="w-full aspect-video block rounded mb-1 bg-black overflow-hidden relative group cursor-pointer">
      <video ref={ref} src={src} poster={poster}
        className="w-full h-full object-cover pointer-events-none"
        muted preload="metadata" playsInline />
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/30 transition-opacity">
        <span className="text-white text-2xl">▶</span>
      </div>
    </button>
  );
}

function MasterPlayer({ src, speed, loop, onEnded, onProgress }: {
  src: string;
  speed: number;
  loop: boolean;
  onEnded?: () => void;
  onProgress?: (frac: number) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let cancelled = false;
    v.load();
    const play = () => {
      if (cancelled) return;
      v.playbackRate = speed;
      v.play().catch(() => {});
    };
    v.addEventListener('loadedmetadata', play, { once: true });
    return () => { cancelled = true; v.removeEventListener('loadedmetadata', play); };
  }, [src, speed]);

  function enterPip() {
    const v = ref.current; if (!v || v.readyState < 1) return;
    if (document.pictureInPictureElement === v) return;
    v.requestPictureInPicture().catch((e) => console.warn('PiP failed:', e));
  }
  function enterFs() {
    const v = ref.current; if (!v) return;
    if (document.fullscreenElement === v) return;
    v.requestFullscreen().catch((e) => console.warn('FS failed:', e));
  }

  return (
    <div className="relative bg-black rounded overflow-hidden border border-stone-300" style={{ aspectRatio: '16/9', maxWidth: 960 }}>
      <video ref={ref} src={src}
        className="w-full h-full block bg-black"
        style={{ objectFit: 'contain' }}
        muted playsInline preload="auto" controls
        loop={loop}
        onTimeUpdate={(e) => {
          if (!onProgress) return;
          const v = e.currentTarget;
          if (v.duration > 0 && Number.isFinite(v.duration)) {
            onProgress(Math.min(1, Math.max(0, v.currentTime / v.duration)));
          }
        }}
        onEnded={loop ? undefined : onEnded} />
      <div className="absolute top-1 right-1 flex gap-1">
        <button type="button" onClick={enterPip} title="Browser PiP"
          className="text-xs px-1.5 py-0.5 bg-black/60 text-white rounded hover:bg-black/80">📺</button>
        <button type="button" onClick={enterFs} title="Fullscreen"
          className="text-xs px-1.5 py-0.5 bg-black/60 text-white rounded hover:bg-black/80">⛶</button>
      </div>
    </div>
  );
}
