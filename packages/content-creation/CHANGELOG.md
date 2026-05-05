# Changelog — @wikitata/content-creation

## 0.1.1 — 2026-05-05

- Verbatim RWS source copied into `src/_baseline-rws/` as the v0.2.0 genericization reference.
- 30 files, ~5,334 LOC: schema (`lib/composition.ts`), components (`Composition.tsx`, `HeroVideo.tsx`), admin pages (`generate-bg`, `compositor`, `compositor/render`), 20 `api/admin/gen/*` routes, 4 `api/admin/compositor/*` routes.
- Build excludes `_baseline-rws/` (Next.js-coupled, not buildable here).
- Not yet imported by any consumer. RWS still runs from its own copy.

## 0.1.0 — 2026-05-05

- Package scaffolded (placeholder — no source yet).
- Establishes export surface, peer deps, build script.
- Next: v0.1.1 will copy RWS source verbatim into `src/`.
- Spec: wikiTaTa card `bc951384`.

## 0.2.0-step1 — 2026-05-05

- **Schema lift**: `lib/composition.ts` (257 LOC, framework-agnostic types + helpers) promoted from `src/_baseline-rws/lib/` to `src/lib/`. Baseline twin deleted. Barrel exports `Box`, `Transition`, `Layer`, `Composition` types + `aspectRatioToNumber`, `effectiveOpacity`, `transitionStyle`, `seedCompositions`.
- Build verified — `dist/` emits clean from `tsc -p tsconfig.build.json`.
- 23 baseline files remain in `src/_baseline-rws/` for steps 2-7.
