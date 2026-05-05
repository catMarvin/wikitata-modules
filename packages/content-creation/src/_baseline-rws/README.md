# `_baseline-rws/` — frozen RWS source

This directory contains a verbatim copy of the readings-with-scot Hero BG +
Compositor implementation as of v0.1.1 (2026-05-05).

**It is intentionally not buildable from this package.** These files use
Next.js App Router idioms (`'use client'`, `next/server`, etc.) and assume a
host Next.js application provides the runtime. The package's `tsconfig.build.json`
explicitly excludes this directory.

## Why preserve it

This is the v0.2.0 genericization reference. As we extract:

- `lib/composition.ts` → `src/lib/composition.ts` (framework-agnostic — straight move)
- `components/Composition.tsx` → `src/components/Composition.tsx` (headless props, consumer applies tokens)
- `components/HeroVideo.tsx` → `src/components/HeroVideo.tsx` (legacy fallback — may drop in v0.3+)
- `admin/generate-bg/page.tsx` → `src/components/BackdropAdmin.tsx` (Next.js page → React component, route mounting becomes consumer responsibility)
- `admin/compositor/*` → `src/components/CompositorAdmin.tsx` + `src/components/CompositorRender.tsx`
- `api/admin/gen/**` (20 routes) → `src/routes/backdrop/*.ts` (route factory functions)
- `api/admin/compositor/**` (4 routes) → `src/routes/compositor/*.ts` (route factory functions)

Once each file has a "real" home in `src/` and is wired through `src/index.ts`,
its baseline twin can be deleted in the same commit.

## Until then

- ✅ DO read these files for reference / design comparison
- ❌ DO NOT import from `_baseline-rws/` anywhere in the package
- ❌ DO NOT modify these files — they're a frozen snapshot. Edit them in
  RWS (where they still live and run) or in their genericized home in `src/`.

## Origin tag

Provenance: `~/git/readings-with-scot/src` HEAD as of 2026-05-05 (RWS S180+).
For the exact commit hash this baseline corresponds to, see this package's
v0.1.1 tag commit message.
