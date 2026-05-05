type Props = {
  desktopSrc: string;
  mobileSrc: string;
  poster?: string;
  mobilePoster?: string;
};

/**
 * Pure-CSS responsive hero video. Two <video> elements, one per breakpoint,
 * swapped via Tailwind display utilities. The hidden one uses `preload="none"`
 * so it doesn't waste bandwidth. CSS handles viewport changes natively — no JS
 * re-render, no flash on resize/rotate.
 *
 * Breakpoint: < 640px (Tailwind `sm`) shows mobile (9:16). >= 640px shows desktop (16:9).
 */
export default function HeroVideo({ desktopSrc, mobileSrc, poster, mobilePoster }: Props) {
  return (
    <>
      {/* Mobile (portrait 9:16) — shown below sm breakpoint */}
      <video
        src={mobileSrc}
        poster={mobilePoster ?? poster}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover sm:hidden"
      />
      {/* Desktop (16:9) — shown at sm and above */}
      <video
        src={desktopSrc}
        poster={poster}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover hidden sm:block"
      />
    </>
  );
}
