'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type Composition,
  type Layer,
  type ImageLayer,
  type VideoLayer,
  type TextLayer,
  aspectRatioToNumber,
  effectiveOpacity,
  transitionStyle,
} from '@/lib/composition';

type Props = {
  comp: Composition;
  /** When non-null, render at exactly this time (ms) and don't animate (preview mode). */
  timeMs?: number | null;
  /** Container size mode: 'fit' (respect aspect ratio) | 'fill' (fill parent, ignoring aspect). */
  sizeMode?: 'fit' | 'fill';
  /** Click handler when a layer is clicked (editor only). */
  onLayerClick?: (layerId: string) => void;
  /** When set, draw a thin outline + label over each layer. */
  selectedLayerId?: string | null;
  showLayerOutlines?: boolean;
  className?: string;
  /** Optional cap on autoplay loop length; otherwise comp.durationMs. */
  loopMs?: number;
};

/**
 * Renders a Composition. In live mode, runs an internal animation clock and
 * loops every `comp.durationMs`. In preview mode (timeMs supplied), renders the
 * frame at that exact time.
 */
export default function Composition({
  comp,
  timeMs,
  sizeMode = 'fill',
  onLayerClick,
  selectedLayerId,
  showLayerOutlines,
  className,
  loopMs,
}: Props) {
  const [now, setNow] = useState(0);
  const startedAt = useRef(performance.now());

  useEffect(() => {
    if (timeMs !== undefined && timeMs !== null) return; // controlled
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - startedAt.current;
      const dur = loopMs ?? comp.durationMs;
      setNow(comp.loop ? elapsed % dur : Math.min(elapsed, dur));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [comp.durationMs, comp.loop, loopMs, timeMs]);

  const t = timeMs ?? now;
  const aspect = aspectRatioToNumber(comp.canvas.aspectRatio);

  const containerStyle: React.CSSProperties =
    sizeMode === 'fit'
      ? { aspectRatio: aspect, width: '100%' }
      : { width: '100%', height: '100%' };

  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ ...containerStyle, background: comp.canvas.background ?? 'transparent' }}
    >
      {[...comp.layers]
        .sort((a, b) => a.z - b.z)
        .map((layer) => (
          <LayerView
            key={layer.id}
            layer={layer}
            t={t}
            selected={selectedLayerId === layer.id}
            outline={!!showLayerOutlines}
            onClick={onLayerClick ? () => onLayerClick(layer.id) : undefined}
          />
        ))}
    </div>
  );
}

function LayerView({
  layer, t, selected, outline, onClick,
}: {
  layer: Layer;
  t: number;
  selected: boolean;
  outline: boolean;
  onClick?: () => void;
}) {
  if (layer.visible === false) return null;
  const op = effectiveOpacity(layer, t);
  if (op <= 0 && !outline) return null;

  const trans = transitionStyle(layer, t);
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${layer.box.x}%`,
    top: `${layer.box.y}%`,
    width: `${layer.box.w}%`,
    height: `${layer.box.h}%`,
    opacity: op,
    zIndex: layer.z,
    transform: trans.transform,
    filter: trans.filter,
    clipPath: trans.clipPath,
    pointerEvents: onClick ? 'auto' : 'none',
    cursor: onClick ? 'pointer' : 'default',
  };

  let inner: React.ReactNode = null;
  if (layer.type === 'image') {
    const l = layer as ImageLayer;
    inner = (
      <img
        src={l.src}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: l.fit ?? 'contain',
          userSelect: 'none',
          display: 'block',
        }}
      />
    );
  } else if (layer.type === 'video') {
    const l = layer as VideoLayer;
    inner = (
      <video
        src={l.src}
        autoPlay
        loop={l.loop ?? true}
        muted={l.muted ?? true}
        playsInline
        style={{ width: '100%', height: '100%', objectFit: l.fit ?? 'cover', display: 'block' }}
      />
    );
  } else if (layer.type === 'text') {
    const l = layer as TextLayer;
    const align = l.align ?? 'center';
    const vAlign = l.vAlign ?? 'center';
    const justifyContent = vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center';
    const textAlign = align;
    inner = (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'stretch',
          flexDirection: 'column',
          justifyContent,
          fontFamily: l.fontFamily ?? 'serif',
          fontStyle: l.fontStyle ?? 'normal',
          fontWeight: l.fontWeight ?? 400,
          color: l.color ?? '#ffffff',
          fontSize: `clamp(0.5rem, ${l.fontSizePct ?? 6}cqh, 20rem)`,
          lineHeight: l.lineHeight ?? 1.15,
          letterSpacing: l.letterSpacingEm != null ? `${l.letterSpacingEm}em` : undefined,
          textShadow: l.textShadow ?? 'none',
          textAlign,
          containerType: 'size',
        }}
      >
        <div style={{ width: '100%', textAlign }}>{l.text}</div>
      </div>
    );
  }

  return (
    <div style={style} onClick={onClick}>
      {inner}
      {outline && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: selected ? '2px solid #d97706' : '1px dashed rgba(255,255,255,0.4)',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: -16,
              left: 0,
              fontSize: 10,
              padding: '2px 4px',
              background: selected ? '#d97706' : 'rgba(0,0,0,0.6)',
              color: '#fff',
              borderRadius: 2,
              whiteSpace: 'nowrap',
            }}
          >
            {layer.name}
          </span>
        </div>
      )}
    </div>
  );
}
