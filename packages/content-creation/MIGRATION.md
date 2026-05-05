# Migration guide — @wikitata/content-creation

## v0.1.x → v0.2.0

v0.1.x was a frozen baseline copy of RWS source for reference. v0.2.0 is the
first consumer-installable surface.

### What you get

- Framework-neutral route factories: `createBackdropRoutes(deps)`, `createCompositorRoutes(deps)` returning `{handler.METHOD: (req) => Promise<Response>}` maps.
- Storage adapters: `FsAdapter`, `SupabaseStorageAdapter`.
- AI adapter: `VercelAIGatewayAdapter`.
- Persistence: `JsonSpecStore`, `JsonCompositionStore`, `SupabaseCostLogStore`, `SupabaseGenLogStore`, `SupabaseBatchSpendLogStore`, plus `Noop*` stubs.
- Migrations: `runMigrations({schema, runner})` creates `cost_log`, `gen_log`, `batch_spend_log` tables.
- Headless components: `Composition`, `HeroVideo`.

### What's NOT in v0.2.0 (deferred to v0.2.1)

- `BackdropAdmin`, `CompositorAdmin`, `CompositorRender` admin React components — paired with consumer adoption tests.
- Backdrop routes: `video` (Kling poller adapter), `stitch` (ffmpeg adapter), `archive` (ArchiveStore), `transformImage` (Fal AI adapter), `backfillAnchors`, `writeProject`.
- Compositor `bake` route (Playwright + ffmpeg).

### How to adopt in RWS

1. `pnpm add @wikitata/content-creation@^0.2.0` in RWS.
2. Replace 11 admin route files in RWS with thin `export const POST = backdropRoutes.X.POST` wrappers.
3. Run `runMigrations({schema: 'public', runner: ...})` against the RWS Supabase project. The created tables (`cost_log`, `gen_log`, `batch_spend_log`) match the existing RWS table shape, BUT:
   - RWS currently writes to `hero_gen_log` and `hero_batch_spend_log` (not `gen_log` / `batch_spend_log`).
   - Either:
     a) Pass `table: 'hero_gen_log'` etc. to `SupabaseGenLogStore` / `SupabaseBatchSpendLogStore` to keep current names; or
     b) Migrate data with a one-time `INSERT INTO gen_log SELECT * FROM hero_gen_log` and switch.
4. Keep the deferred RWS routes (video, stitch, archive, transformImage, backfillAnchors, writeProject) running from RWS source until v0.2.1.

### How to adopt in wikitata

1. `pnpm add @wikitata/content-creation@^0.2.0` in wikitata.
2. Use `SupabaseStorageAdapter` against a `backdrop` bucket.
3. Run `runMigrations({schema: 'wikitata', runner: ...})`.
4. Mount routes under `/content-creation/{video-designer,compositor}/...` per spec card `bc951384`.
5. Build admin UI — for v0.2.0 use the route-only surface; for v0.2.1 import the headless admin components.

## Future versions

- **v0.2.1** — admin components + deferred routes. RWS adoption test required as gate.
- **v0.3.0** — DB-backed SpecStore + CompositionStore (rows in `backdrop_specs` / `compositions` tables instead of JSON-on-storage).
- **v1.0.0** — adapter-version stability commitment + LTS.
