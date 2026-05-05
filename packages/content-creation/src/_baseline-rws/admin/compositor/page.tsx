'use client';

import { useEffect, useRef, useState } from 'react';
import Composition from '@/app/_components/Composition';
import {
  type Composition as Comp,
  type Layer,
  type Box,
  type TransitionKind,
  aspectRatioToNumber,
} from '@/lib/composition';

const TRANSITION_KINDS: TransitionKind[] = [
  'fade', 'blur', 'dither',
  'slide-up', 'slide-down', 'slide-left', 'slide-right',
  'wipe-up', 'wipe-down', 'wipe-left', 'wipe-right',
  'scale-up', 'scale-down',
];

const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '3:2'];

type Asset = { filename: string; url: string };

export default function CompositorPage() {
  const [list, setList] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [comp, setComp] = useState<Comp | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const playStartedAt = useRef(0);
  const playOffset = useRef(0);

  // Load list on mount
  useEffect(() => {
    fetch('/api/admin/compositor/list').then((r) => r.json()).then((j) => {
      setList(j.compositions ?? []);
      const homeId = (j.compositions ?? []).find((c: { slug: string }) => c.slug === 'home-hero')?.id ?? j.compositions?.[0]?.id;
      if (homeId) loadComp(homeId);
    });
    fetch('/api/admin/compositor/asset').then((r) => r.json()).then((j) => setAssets(j.assets ?? []));
  }, []);

  function loadComp(id: string) {
    fetch(`/api/admin/compositor/${id}`).then((r) => r.json()).then((c: Comp) => {
      setComp(c);
      setSelectedId(c.layers[0]?.id ?? null);
      setT(0);
      setDirty(false);
      playOffset.current = 0;
      playStartedAt.current = performance.now();
    });
  }

  // Animation clock
  useEffect(() => {
    if (!playing || !comp) return;
    playStartedAt.current = performance.now() - playOffset.current;
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - playStartedAt.current;
      const v = comp.loop ? elapsed % comp.durationMs : Math.min(elapsed, comp.durationMs);
      setT(v);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, comp]);

  function setTimeManual(ms: number) {
    setPlaying(false);
    playOffset.current = ms;
    setT(ms);
  }

  function mutateComp(fn: (c: Comp) => Comp) {
    if (!comp) return;
    setComp(fn(comp));
    setDirty(true);
  }

  function mutateLayer(layerId: string, patch: Partial<Layer>) {
    mutateComp((c) => ({
      ...c,
      layers: c.layers.map((l) => (l.id === layerId ? ({ ...l, ...patch } as Layer) : l)),
    }));
  }

  function addLayer(type: 'image' | 'video' | 'text') {
    if (!comp) return;
    const id = `${type}-${Date.now().toString(36)}`;
    const base = {
      id,
      name: `${type[0].toUpperCase()}${type.slice(1)} layer`,
      box: { x: 20, y: 30, w: 60, h: 30 },
      startMs: 0,
      endMs: comp.durationMs,
      z: comp.layers.length + 1,
      transitionIn: { kind: 'fade' as TransitionKind, durationMs: 800 },
      transitionOut: { kind: 'fade' as TransitionKind, durationMs: 600 },
      visible: true,
    };
    let layer: Layer;
    if (type === 'image') layer = { ...base, type: 'image', src: '', fit: 'contain' };
    else if (type === 'video') layer = { ...base, type: 'video', src: '', fit: 'cover', loop: true, muted: true };
    else layer = { ...base, type: 'text', text: 'New text', fontFamily: 'serif', fontSizePct: 6, color: '#ffffff', align: 'center', vAlign: 'center' };
    mutateComp((c) => ({ ...c, layers: [...c.layers, layer] }));
    setSelectedId(id);
  }

  function deleteLayer(id: string) {
    mutateComp((c) => ({ ...c, layers: c.layers.filter((l) => l.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  function duplicateLayer(id: string) {
    if (!comp) return;
    const orig = comp.layers.find((l) => l.id === id);
    if (!orig) return;
    const copy: Layer = { ...orig, id: `${orig.type}-${Date.now().toString(36)}`, name: `${orig.name} copy`, z: orig.z + 1 } as Layer;
    mutateComp((c) => ({ ...c, layers: [...c.layers, copy] }));
    setSelectedId(copy.id);
  }

  function reorderLayer(id: string, dz: number) {
    if (!comp) return;
    mutateLayer(id, {
      z: Math.max(0, (comp.layers.find((l) => l.id === id)?.z ?? 0) + dz),
    });
  }

  async function save() {
    if (!comp) return;
    setSaving(true);
    const r = await fetch(`/api/admin/compositor/${comp.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(comp),
    });
    if (r.ok) setDirty(false);
    setSaving(false);
  }

  async function uploadAsset(file: File): Promise<Asset | null> {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/admin/compositor/asset', { method: 'POST', body: fd });
    if (!r.ok) return null;
    const j = (await r.json()) as { url: string; filename: string };
    const newAsset: Asset = { filename: j.filename, url: j.url };
    setAssets((a) => [...a.filter((x) => x.filename !== j.filename), newAsset]);
    return newAsset;
  }

  if (!comp) {
    return <div className="p-8 text-stone-500">Loading compositor…</div>;
  }

  const selected = comp.layers.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3 border-b border-stone-200 pb-3">
        <h1 className="text-2xl font-semibold">Compositor</h1>
        <select
          value={comp.id}
          onChange={(e) => loadComp(e.target.value)}
          className="border border-stone-300 rounded px-2 py-1 text-sm bg-white text-stone-900"
        >
          {list.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.slug})</option>)}
        </select>
        <input
          value={comp.name}
          onChange={(e) => mutateComp((c) => ({ ...c, name: e.target.value }))}
          className="border border-stone-300 rounded px-2 py-1 text-sm bg-white text-stone-900"
        />
        <span className="text-xs text-stone-500">slug: <code>{comp.slug}</code></span>
        <select
          value={comp.canvas.aspectRatio}
          onChange={(e) => mutateComp((c) => ({ ...c, canvas: { ...c.canvas, aspectRatio: e.target.value } }))}
          className="border border-stone-300 rounded px-2 py-1 text-xs bg-white text-stone-900"
        >
          {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="text-xs text-stone-600">duration
          <input type="number" min={500} step={100}
            value={comp.durationMs}
            onChange={(e) => mutateComp((c) => ({ ...c, durationMs: Number(e.target.value) }))}
            className="ml-1 w-24 border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900" />
          ms
        </label>
        <label className="text-xs text-stone-600 flex items-center gap-1">
          <input type="checkbox" checked={comp.loop ?? false}
            onChange={(e) => mutateComp((c) => ({ ...c, loop: e.target.checked }))} />
          loop
        </label>
        <label className="text-xs text-stone-600">bg
          <input type="text" value={comp.canvas.background ?? ''}
            onChange={(e) => mutateComp((c) => ({ ...c, canvas: { ...c.canvas, background: e.target.value } }))}
            className="ml-1 w-24 border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900" />
        </label>
        <div className="ml-auto flex gap-2">
          <a href={`/api/admin/compositor/${comp.id}`} target="_blank" rel="noreferrer"
            className="text-xs px-2 py-1 border border-stone-300 rounded hover:bg-stone-50">JSON</a>
          <button type="button" onClick={save} disabled={saving || !dirty}
            className="text-sm px-4 py-1.5 bg-amber-700 text-white rounded disabled:opacity-50">
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </header>

      <div className="grid gap-3" style={{ gridTemplateColumns: '220px 1fr 280px' }}>
        {/* Left: layers */}
        <aside className="border border-stone-200 rounded p-2 bg-stone-50 max-h-[600px] overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-stone-700">Layers</div>
            <div className="flex gap-1">
              <button type="button" onClick={() => addLayer('text')}
                data-tooltip="Add text layer" aria-label="Add text layer"
                className="text-[10px] px-1.5 py-0.5 border rounded bg-white hover:bg-stone-100">+T</button>
              <button type="button" onClick={() => addLayer('image')}
                data-tooltip="Add image layer" aria-label="Add image layer"
                className="text-[10px] px-1.5 py-0.5 border rounded bg-white hover:bg-stone-100">+I</button>
              <button type="button" onClick={() => addLayer('video')}
                data-tooltip="Add video layer" aria-label="Add video layer"
                className="text-[10px] px-1.5 py-0.5 border rounded bg-white hover:bg-stone-100">+V</button>
            </div>
          </div>
          <ul className="space-y-1">
            {[...comp.layers].sort((a, b) => b.z - a.z).map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setSelectedId(l.id)}
                  className={`w-full text-left text-xs px-2 py-1 rounded flex items-center gap-2 ${selectedId === l.id ? 'bg-amber-200' : 'hover:bg-stone-100'}`}>
                  <span className="font-mono text-stone-500">[{l.type[0]}]</span>
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="text-[9px] text-stone-500">z{l.z}</span>
                </button>
                {selectedId === l.id && (
                  <div className="flex gap-1 mt-1 ml-4 text-[10px]">
                    <button onClick={() => reorderLayer(l.id, 1)} className="px-1 border rounded bg-white">↑</button>
                    <button onClick={() => reorderLayer(l.id, -1)} className="px-1 border rounded bg-white">↓</button>
                    <button onClick={() => duplicateLayer(l.id)} className="px-1 border rounded bg-white">dup</button>
                    <button onClick={() => mutateLayer(l.id, { visible: l.visible === false })} className="px-1 border rounded bg-white">{l.visible === false ? 'show' : 'hide'}</button>
                    <button onClick={() => deleteLayer(l.id)} className="px-1 border border-red-300 text-red-600 rounded bg-white">del</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </aside>

        {/* Center: canvas */}
        <div className="border border-stone-200 rounded bg-stone-100 p-3">
          <CanvasPreview
            comp={comp}
            t={t}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onBoxChange={(id, box) => mutateLayer(id, { box })}
          />
          <Timeline comp={comp} t={t} setT={setTimeManual} playing={playing} setPlaying={setPlaying} selectedId={selectedId} setSelected={setSelectedId} />
        </div>

        {/* Right: properties */}
        <aside className="border border-stone-200 rounded p-3 bg-white max-h-[600px] overflow-auto">
          {selected ? (
            <PropertiesPanel
              layer={selected}
              comp={comp}
              assets={assets}
              onChange={(patch) => mutateLayer(selected.id, patch)}
              onUpload={uploadAsset}
            />
          ) : (
            <div className="text-xs text-stone-500">Select a layer to edit its properties.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function CanvasPreview({
  comp, t, selectedId, onSelect, onBoxChange,
}: {
  comp: Comp;
  t: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBoxChange: (id: string, box: Box) => void;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={wrap}
      className="relative w-full bg-black rounded overflow-hidden"
      style={{ aspectRatio: aspectRatioToNumber(comp.canvas.aspectRatio) }}
    >
      <Composition
        comp={comp}
        timeMs={t}
        sizeMode="fill"
        onLayerClick={onSelect}
        selectedLayerId={selectedId}
        showLayerOutlines={true}
      />
      {/* Drag handles for selected layer */}
      {selectedId && wrap.current && (
        <BoxHandles
          comp={comp}
          layerId={selectedId}
          containerEl={wrap.current}
          onBoxChange={(box) => onBoxChange(selectedId, box)}
        />
      )}
    </div>
  );
}

type Drag =
  | { mode: 'move'; startX: number; startY: number; startBox: Box }
  | { mode: 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'; startX: number; startY: number; startBox: Box };

function BoxHandles({
  comp, layerId, containerEl, onBoxChange,
}: {
  comp: Comp;
  layerId: string;
  containerEl: HTMLElement;
  onBoxChange: (b: Box) => void;
}) {
  const layer = comp.layers.find((l) => l.id === layerId);
  const [drag, setDrag] = useState<Drag | null>(null);
  if (!layer) return null;
  const box = layer.box;

  function pctFromEvent(e: { clientX: number; clientY: number }) {
    const rect = containerEl.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }

  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent) {
      if (!drag) return;
      const p = pctFromEvent(e);
      if (drag.mode === 'move') {
        const dx = p.x - drag.startX;
        const dy = p.y - drag.startY;
        onBoxChange({
          x: Math.max(0, Math.min(100 - drag.startBox.w, drag.startBox.x + dx)),
          y: Math.max(0, Math.min(100 - drag.startBox.h, drag.startBox.y + dy)),
          w: drag.startBox.w,
          h: drag.startBox.h,
        });
      } else {
        let { x, y, w, h } = drag.startBox;
        const dx = p.x - drag.startX;
        const dy = p.y - drag.startY;
        if (drag.corner.includes('w')) { x += dx; w -= dx; }
        if (drag.corner.includes('e')) { w += dx; }
        if (drag.corner.includes('n')) { y += dy; h -= dy; }
        if (drag.corner.includes('s')) { h += dy; }
        if (w >= 2 && h >= 2 && x >= 0 && y >= 0 && x + w <= 100 && y + h <= 100) onBoxChange({ x, y, w, h });
      }
    }
    function onUp() { setDrag(null); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, onBoxChange]);

  function startMove(e: React.MouseEvent) {
    e.stopPropagation();
    const p = pctFromEvent(e);
    setDrag({ mode: 'move', startX: p.x, startY: p.y, startBox: box });
  }
  function startResize(corner: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w') {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      const p = pctFromEvent(e);
      setDrag({ mode: 'resize', corner, startX: p.x, startY: p.y, startBox: box });
    };
  }

  const handle = (style: React.CSSProperties, cursor: string, onMouseDown: (e: React.MouseEvent) => void) => (
    <div onMouseDown={onMouseDown} style={{ position: 'absolute', width: 10, height: 10, background: '#d97706', border: '2px solid white', borderRadius: 2, cursor, zIndex: 1000, ...style }} />
  );

  return (
    <div
      onMouseDown={startMove}
      style={{
        position: 'absolute',
        left: `${box.x}%`,
        top: `${box.y}%`,
        width: `${box.w}%`,
        height: `${box.h}%`,
        cursor: 'move',
        zIndex: 999,
        border: '2px dashed #d97706',
      }}
    >
      {handle({ left: -5, top: -5 }, 'nwse-resize', startResize('nw'))}
      {handle({ right: -5, top: -5 }, 'nesw-resize', startResize('ne'))}
      {handle({ left: -5, bottom: -5 }, 'nesw-resize', startResize('sw'))}
      {handle({ right: -5, bottom: -5 }, 'nwse-resize', startResize('se'))}
      {handle({ left: '50%', top: -5, marginLeft: -5 }, 'ns-resize', startResize('n'))}
      {handle({ left: '50%', bottom: -5, marginLeft: -5 }, 'ns-resize', startResize('s'))}
      {handle({ top: '50%', left: -5, marginTop: -5 }, 'ew-resize', startResize('w'))}
      {handle({ top: '50%', right: -5, marginTop: -5 }, 'ew-resize', startResize('e'))}
    </div>
  );
}

function Timeline({
  comp, t, setT, playing, setPlaying, selectedId, setSelected,
}: {
  comp: Comp;
  t: number;
  setT: (ms: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  selectedId: string | null;
  setSelected: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  function pctOf(ms: number) { return (ms / comp.durationMs) * 100; }

  function onScrub(e: React.MouseEvent) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = (e.clientX - rect.left) / rect.width;
    setT(Math.max(0, Math.min(comp.durationMs, p * comp.durationMs)));
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-1">
        <button type="button" onClick={() => setPlaying(!playing)}
          className="text-xs px-2 py-1 border border-stone-300 rounded bg-white hover:bg-stone-50">
          {playing ? '❚❚ pause' : '▶ play'}
        </button>
        <button type="button" onClick={() => setT(0)}
          className="text-xs px-2 py-1 border border-stone-300 rounded bg-white hover:bg-stone-50">⏮ start</button>
        <span className="text-xs text-stone-600 font-mono">{(t / 1000).toFixed(2)}s / {(comp.durationMs / 1000).toFixed(2)}s</span>
      </div>
      <div className="relative bg-stone-200 rounded h-12 cursor-crosshair" ref={trackRef} onMouseDown={onScrub}>
        {/* Layer bars */}
        {comp.layers.map((l, i) => {
          const top = 2 + (i % 4) * 9;
          return (
            <div key={l.id}
              onMouseDown={(e) => { e.stopPropagation(); setSelected(l.id); }}
              style={{
                position: 'absolute',
                left: `${pctOf(l.startMs)}%`,
                width: `${pctOf(l.endMs - l.startMs)}%`,
                top, height: 8,
                background: selectedId === l.id ? '#d97706' : '#a8a29e',
                borderRadius: 2,
                cursor: 'pointer',
              }}
              title={`${l.name} · ${l.startMs}–${l.endMs}ms`}
            />
          );
        })}
        {/* Playhead */}
        <div style={{
          position: 'absolute',
          left: `${pctOf(t)}%`,
          top: 0, bottom: 0,
          width: 2,
          background: '#dc2626',
          pointerEvents: 'none',
        }} />
      </div>
    </div>
  );
}

function PropertiesPanel({
  layer, comp, assets, onChange, onUpload,
}: {
  layer: Layer;
  comp: Comp;
  assets: Asset[];
  onChange: (patch: Partial<Layer>) => void;
  onUpload: (f: File) => Promise<Asset | null>;
}) {
  return (
    <div className="space-y-3 text-xs">
      <Field label="name">
        <input value={layer.name} onChange={(e) => onChange({ name: e.target.value })}
          className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900" />
      </Field>
      <div className="grid grid-cols-4 gap-1">
        <Field label="x"><NumInput v={layer.box.x} on={(n) => onChange({ box: { ...layer.box, x: n } })} /></Field>
        <Field label="y"><NumInput v={layer.box.y} on={(n) => onChange({ box: { ...layer.box, y: n } })} /></Field>
        <Field label="w"><NumInput v={layer.box.w} on={(n) => onChange({ box: { ...layer.box, w: n } })} /></Field>
        <Field label="h"><NumInput v={layer.box.h} on={(n) => onChange({ box: { ...layer.box, h: n } })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Field label="start ms"><NumInput v={layer.startMs} on={(n) => onChange({ startMs: n })} step={100} max={comp.durationMs} /></Field>
        <Field label="end ms"><NumInput v={layer.endMs} on={(n) => onChange({ endMs: n })} step={100} max={comp.durationMs} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Field label="z"><NumInput v={layer.z} on={(n) => onChange({ z: n })} step={1} /></Field>
        <Field label="opacity"><NumInput v={layer.opacity ?? 1} on={(n) => onChange({ opacity: n })} step={0.05} max={1} min={0} /></Field>
      </div>

      <div className="border-t pt-2">
        <div className="text-stone-500 font-semibold mb-1">Transitions</div>
        <Field label="in">
          <select value={layer.transitionIn?.kind ?? ''}
            onChange={(e) => onChange({ transitionIn: e.target.value ? { kind: e.target.value as TransitionKind, durationMs: layer.transitionIn?.durationMs ?? 800 } : undefined })}
            className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900">
            <option value="">none</option>
            {TRANSITION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          {layer.transitionIn && (
            <NumInput v={layer.transitionIn.durationMs}
              on={(n) => onChange({ transitionIn: { ...layer.transitionIn!, durationMs: n } })} step={100} />
          )}
        </Field>
        <Field label="out">
          <select value={layer.transitionOut?.kind ?? ''}
            onChange={(e) => onChange({ transitionOut: e.target.value ? { kind: e.target.value as TransitionKind, durationMs: layer.transitionOut?.durationMs ?? 600 } : undefined })}
            className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900">
            <option value="">none</option>
            {TRANSITION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          {layer.transitionOut && (
            <NumInput v={layer.transitionOut.durationMs}
              on={(n) => onChange({ transitionOut: { ...layer.transitionOut!, durationMs: n } })} step={100} />
          )}
        </Field>
      </div>

      {layer.type === 'text' && (
        <div className="border-t pt-2 space-y-2">
          <div className="text-stone-500 font-semibold">Text</div>
          <Field label="text">
            <textarea rows={2} value={layer.text}
              onChange={(e) => onChange({ text: e.target.value } as Partial<Layer>)}
              className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900" />
          </Field>
          <div className="grid grid-cols-2 gap-1">
            <Field label="font family"><input value={layer.fontFamily ?? ''}
              onChange={(e) => onChange({ fontFamily: e.target.value } as Partial<Layer>)}
              className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900" /></Field>
            <Field label="size %h"><NumInput v={layer.fontSizePct ?? 6} on={(n) => onChange({ fontSizePct: n } as Partial<Layer>)} step={0.5} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Field label="weight"><NumInput v={layer.fontWeight ?? 400} on={(n) => onChange({ fontWeight: n } as Partial<Layer>)} step={100} /></Field>
            <Field label="color"><input type="color" value={layer.color ?? '#ffffff'}
              onChange={(e) => onChange({ color: e.target.value } as Partial<Layer>)}
              className="w-full h-7 border border-stone-300 rounded" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Field label="align">
              <select value={layer.align ?? 'center'}
                onChange={(e) => onChange({ align: e.target.value as 'left' | 'center' | 'right' } as Partial<Layer>)}
                className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900">
                <option value="left">left</option><option value="center">center</option><option value="right">right</option>
              </select>
            </Field>
            <Field label="vAlign">
              <select value={layer.vAlign ?? 'center'}
                onChange={(e) => onChange({ vAlign: e.target.value as 'top' | 'center' | 'bottom' } as Partial<Layer>)}
                className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900">
                <option value="top">top</option><option value="center">center</option><option value="bottom">bottom</option>
              </select>
            </Field>
          </div>
          <Field label="shadow"><input value={layer.textShadow ?? ''}
            onChange={(e) => onChange({ textShadow: e.target.value } as Partial<Layer>)}
            placeholder="0 4px 24px rgba(0,0,0,0.7)"
            className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900" /></Field>
        </div>
      )}

      {(layer.type === 'image' || layer.type === 'video') && (
        <div className="border-t pt-2 space-y-2">
          <div className="text-stone-500 font-semibold">Asset</div>
          <Field label="src">
            <input value={layer.src}
              onChange={(e) => onChange({ src: e.target.value } as Partial<Layer>)}
              className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900" />
          </Field>
          <div className="flex flex-wrap gap-1">
            {assets.filter((a) => layer.type === 'image' ? /\.(png|jpe?g|gif|webp|svg)$/i.test(a.url) : /\.(mp4|webm|mov)$/i.test(a.url)).map((a) => (
              <button key={a.url} type="button"
                onClick={() => onChange({ src: a.url } as Partial<Layer>)}
                className={`text-[10px] px-1.5 py-0.5 border rounded ${layer.src === a.url ? 'border-amber-700 bg-amber-50' : 'border-stone-300 bg-white hover:bg-stone-50'}`}
                title={a.url}>
                {a.filename}
              </button>
            ))}
          </div>
          <label className="text-[11px] px-2 py-1 border border-stone-300 rounded cursor-pointer hover:bg-stone-50 inline-block">
            Upload new
            <input type="file" accept={layer.type === 'image' ? 'image/*' : 'video/*'} className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const a = await onUpload(f);
                if (a) onChange({ src: a.url } as Partial<Layer>);
              }} />
          </label>
          <Field label="fit">
            <select value={layer.fit ?? (layer.type === 'image' ? 'contain' : 'cover')}
              onChange={(e) => onChange({ fit: e.target.value as 'contain' | 'cover' | 'fill' } as Partial<Layer>)}
              className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900">
              <option value="contain">contain</option><option value="cover">cover</option><option value="fill">fill</option>
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-0.5">{label}</div>
      <div>{children}</div>
    </label>
  );
}

function NumInput({ v, on, step = 1, min, max }: { v: number; on: (n: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <input type="number" value={v}
      step={step} min={min} max={max}
      onChange={(e) => on(Number(e.target.value))}
      className="w-full border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-900" />
  );
}
