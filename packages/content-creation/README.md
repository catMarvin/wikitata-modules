# @wikitata/content-creation

Video Designer + Compositor — shared content-creation module for the wikiTaTa ecosystem.

> **Naming note**: "Video Designer" was originally "Hero BG" in readings-with-scot.
> The renamed pipeline is: **AI-describe** anchor images → **queue render** via Vercel
> AI Gateway (Flux for stills, Kling i2v for transitions) → **blend** segments into a
> seamless loop. The **Compositor** then takes that video and lets you lay text /
> images / additional video over it on a timeline, with bake-to-mp4 via Playwright + ffmpeg.

## Status

**v0.1.0 — baseline scaffold.** This release establishes the package shape but does
not yet contain extracted code. The next commits will:

1. Copy RWS source verbatim → `src/` (no genericization, just "in the package")
2. RWS migrates to importing from `@wikitata/content-creation@0.1.x` and verifies
   identical mp4 output before the v0.2 genericization PR lands.

## Planned exports

```ts
// schemas
import { compositionSchema, layerSchema, anchorSchema } from '@wikitata/content-creation'

// components (headless — consumer applies Steel-blue tokens per card 68c40443)
import { BackdropAdmin, CompositorAdmin, Composition } from '@wikitata/content-creation/components'

// route factories (mountable under any prefix in any framework)
import { createBackdropRoutes, createCompositorRoutes } from '@wikitata/content-creation/routes'

// adapters
import { createStorageAdapter, createAIAdapter } from '@wikitata/content-creation/adapters'

// migrations
import { runMigrations } from '@wikitata/content-creation/migrations'
```

See spec card `bc951384` for full 16-section design.

## Source provenance

Initial baseline copied from:

- `~/git/readings-with-scot/src/lib/composition.ts`
- `~/git/readings-with-scot/src/app/_components/Composition.tsx`
- `~/git/readings-with-scot/src/app/(public)/_components/HeroVideo.tsx`
- `~/git/readings-with-scot/src/app/admin/generate-bg/page.tsx`
- `~/git/readings-with-scot/src/app/admin/compositor/page.tsx`
- `~/git/readings-with-scot/src/app/admin/compositor/render/page.tsx`
- `~/git/readings-with-scot/src/app/api/admin/gen/**` (~20 routes)
- `~/git/readings-with-scot/src/app/api/admin/compositor/**` (4 routes)

## Style

Any UI shipped by this package consumes Steel-blue token canon (card `68c40443`).
Tokens applied by consumer — package ships headless components.

## Versioning

Semver. Breaking schema or signature changes require a major bump and a
`MIGRATION.md` entry.
