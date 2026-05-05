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
