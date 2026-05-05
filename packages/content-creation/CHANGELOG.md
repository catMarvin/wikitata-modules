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

## 0.2.0-step2 — 2026-05-05

- **Storage adapter contract**: `StorageAdapter` interface in `src/adapters/storage.ts` — readFile, writeFile, deleteFile, copyFile, exists, stat, listDir, publicUrl. Path traversal rejected at the adapter boundary via `assertSafePath()`.
- **FsAdapter**: Node `fs/promises` impl rooted at a configured `baseDir`, optional `urlPrefix` for public URLs (e.g. `/generated`).
- **SupabaseStorageAdapter**: Supabase Storage bucket impl. Consumer provides their own client (peer-deps-style); supports public buckets via `getPublicUrl()` and private via async `signedUrl()`.
- **Tests**: 8 vitest cases on FsAdapter (round-trip, exists, listDir, idempotent delete, copyFile parents, urlPrefix, traversal rejection, baseDir-must-be-absolute). All passing.
- Barrel: adapters surfaced through `src/index.ts` + `@wikitata/content-creation/adapters` subpath.

## 0.2.0-step3 — 2026-05-05

- **Headless components lifted**: `Composition.tsx` (212 LOC) + `HeroVideo.tsx` (45 LOC) promoted from `_baseline-rws/components/` to `src/components/`. Import alias `@/lib/composition` rewritten to relative `../lib/composition.js`. Baseline twins deleted.
- Both components are framework-agnostic React (use only `useEffect`/`useRef`/`useState`). They consume URL strings as props — URL resolution is consumer's job via `StorageAdapter.publicUrl()`.
- Components barrel at `src/components/index.ts`; subpath export `@wikitata/content-creation/components`.
- Build clean.

## 0.2.0-step4a — 2026-05-05

- **AIAdapter contract**: `src/adapters/ai.ts` — generateImage, generateVideo, generateChat, getUsage, listModels. MeasuredResult<T> wrapper attributes per-call cost when the gateway reports it via header.
- **VercelAIGatewayAdapter**: `src/adapters/ai-vercel-gateway.ts` — calls AI Gateway's OpenAI-compatible REST surface. Async key getter (no plaintext caching). Cost extracted from `x-vercel-ai-gateway-cost-usd` header.
- Video generation throws by default in step4a — wires in step4b along with route conversions (Kling i2v needs AI SDK's experimental_generateVideo or direct provider calls; deferring until used).
- Build clean.

## 0.2.0-step4b — 2026-05-05

- **Route factory shape**: `RouteHandler = (req: Request) => Promise<Response>` — Web-standard. Consumer wires into Next.js / Hono / Express / etc.
- **AuthAdapter + EnvAdapter** consumer-supplied contracts in `src/routes/types.ts`.
- **Helpers**: `jsonResponse`, `errorResponse`, `withAdmin` (admin-gated handler wrapper with consistent error mapping).
- **First three routes converted** (no AI/spec dependencies): `models` (list models), `balance` (gateway usage), `file` (read generated artifact via StorageAdapter).
- `createBackdropRoutes(deps): BackdropRoutes` factory returns prebound handlers.
- 14 baseline routes remain in `_baseline-rws/api/admin/gen/` for steps 4c–4e.
- Build clean.

## 0.2.0-step4c — 2026-05-05

- **Spec schema lifted**: `src/lib/spec.ts` — `Spec`, `SpecAnchor`, `SpecSegment`, `PromptHistoryEntry` types + `defaultBridgePrompt`, `rebuildSegments`, `assertValidSpec` helpers. Lifted from RWS `src/lib/spec-store.ts` (framework-agnostic portion).
- **JsonSpecStore**: `src/persistence/spec-store.ts` — `SpecStore` interface + JSON-on-StorageAdapter impl. Configurable path + project-supplied `defaultSpec` factory + optional `bridgePrompt` override. DB-backed variant lands step 7.
- **4 routes converted**: `spec` (GET+POST), `specInsert` (POST), `specDelete` (POST), `state` (GET — aggregated editor state with anchor/segment file presence via `StorageAdapter.listDir`).
- `createBackdropRoutes()` now requires `specStore` in its deps.
- 11 baseline routes remain in `_baseline-rws/api/admin/gen/`: anchor, video, reassess, stitch, upload, archive, log, batch-log, normalize-anchor, backfill-anchors, promote-lab, transform-image, write-project.
- Build clean.

## 0.2.0-step4d — 2026-05-05

- **Persistence stores**: `CostLogStore`, `GenLogStore`, `BatchSpendLogStore` interfaces + Supabase implementations + Noop variants. Defaults: tables `cost_log`, `hero_gen_log`, `hero_batch_spend_log` (overridable per consumer).
- **Cost constants**: `src/lib/cost-constants.ts` exports `COST_PER` (flux, kling_std/pro, haiku_estimate).
- **4 routes converted**:
  - `log` (GET / POST / PATCH) — operation log with archive_visible action.
  - `batchLog` (GET / POST) — bulk-render summary rows.
  - `anchor` (POST) — Flux image gen via `AIAdapter.generateImage`, materialize bytes (b64 or URL fetch), write via StorageAdapter, log cost.
  - `reassess` (POST) — Claude haiku visual-director check via `AIAdapter.generateChat`, parse strict JSON verdict, log cost. Anchor file discovery via `storage.listDir('anchors')`.
- 7 baseline routes remain: video, stitch, upload, archive, normalize-anchor, backfill-anchors, promote-lab, transform-image, write-project.
- Build clean.

## 0.2.0-step4e — 2026-05-05

- **Sharp normalize helper**: `src/lib/normalize.ts` — `normalizeToAspect(bytes, aspect)` (center cover-crop + resize to PNG; skips when input within 1% of target ratio).
- **3 routes converted**: `upload` (multipart formData + sharp normalize + raw preserve), `promoteLab` (storage.copyFile from `lab/` → `anchors/`), `normalizeAnchor` (re-normalize latest anchor file with original preserved).
- **Deferred to v0.2.1+** (need extra adapters): `video` (Kling poller), `stitch` (ffmpeg adapter), `archive` (ArchiveStore), `transformImage` (Fal adapter), `backfillAnchors` (RWS-specific FS→cloud sync), `writeProject` (RWS-specific snapshot wrap). RWS continues to run these from its own copy.
- 11 of 18 backdrop handlers now in package · 7 deferred · 0 baseline backdrop files remaining once step4 is closed.
- Build clean.

## 0.2.0-step5 — 2026-05-05

- **CompositionStore**: `src/persistence/composition-store.ts` — `CompositionStore` interface + `JsonCompositionStore` (StorageAdapter-backed JSON document, default path `compositions.json`).
- **3 compositor routes converted**: `list` (GET), `asset` (GET/POST — multipart upload + safe-name slugifier; configurable `assetPrefix`, default `assets`), `byId` (GET/POST/DELETE — accepts resolved id at handler-bind time so it stays framework-neutral).
- `createCompositorRoutes(deps): CompositorRoutes` factory.
- Bake (Playwright + ffmpeg rasterizer) deferred to v0.2.1 — needs heavyweight peer deps.
- Build clean.

## 0.2.0 — 2026-05-05 — RELEASED

Genericization milestone reached. v0.2.0 ships the framework-neutral runtime
surface for Video Designer + Compositor: route factories, adapters, persistence,
schema, headless components, and a migration runner.

### Highlights
- **Framework-neutral routes**: `(req: Request) => Promise<Response>` handlers,
  mountable in Next.js / Hono / Express / etc.
- **11 of 18 backdrop routes** + **3 of 4 compositor routes** shipped.
- **Storage**: FsAdapter + SupabaseStorageAdapter.
- **AI**: VercelAIGatewayAdapter (image, chat, usage, models).
- **Persistence**: SpecStore, CompositionStore, CostLog/GenLog/BatchSpendLog
  (interfaces + Supabase impls + Noop stubs).
- **Headless components**: Composition, HeroVideo.
- **Migrations**: cost_log, gen_log, batch_spend_log tables; idempotent runner
  with consumer-supplied SQL client.
- **Subpath exports**: `/components`, `/routes`, `/adapters`, `/migrations`.
- **README + MIGRATION.md** documenting adoption flow for RWS + wikitata.

### Deferred to v0.2.1 (paired with consumer adoption tests)
- Admin React components: BackdropAdmin (2,235 LOC), CompositorAdmin (647 LOC), CompositorRender (35 LOC).
- Backdrop video route (Kling poller adapter).
- Backdrop stitch route (ffmpeg adapter).
- Backdrop archive route (ArchiveStore).
- Backdrop transformImage route (Fal AI adapter).
- Backdrop backfillAnchors / writeProject (RWS-specific use cases).
- Compositor bake route (Playwright + ffmpeg).

### Spec & style anchors
- Extraction spec: wikiTaTa card `bc951384`.
- Style canon: card `68c40443` (Steel blue).
- UI Model: card `dd5b4e22`.
- Module Resource Library parent: card `e10d895e`.

### Source provenance
- Initial baseline: RWS commit `b330f7d` (2026-05-05).
