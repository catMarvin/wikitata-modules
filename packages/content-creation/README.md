# @wikitata/content-creation

Video Designer + Compositor — shared content-creation module for the wikiTaTa ecosystem.

> **Naming note**: "Video Designer" was originally "Hero BG" in readings-with-scot.
> The pipeline is: **AI-describe** anchor images → **queue render** via Vercel
> AI Gateway (Flux for stills, Kling i2v for transitions) → **blend** segments
> into a seamless loop. The **Compositor** then takes that video and lets you
> lay text / images / additional video over it on a timeline, with bake-to-mp4
> via Playwright + ffmpeg.

## Status — v0.2.0

Server-side surface complete and consumer-mountable:

| Layer | Status |
|---|---|
| Schema (Composition + Spec types) | ✅ shipped |
| Storage adapters (FS + Supabase) | ✅ shipped |
| AI adapter (Vercel Gateway: image, chat, usage, models) | ✅ shipped |
| Persistence (SpecStore, CompositionStore, CostLog, GenLog, BatchSpendLog) | ✅ shipped |
| Backdrop routes (11 of 18 — models, balance, file, spec, specInsert, specDelete, state, log, batchLog, anchor, reassess, upload, promoteLab, normalizeAnchor) | ✅ shipped |
| Compositor routes (3 of 4 — list, asset, byId) | ✅ shipped |
| Migrations runner | ✅ shipped |
| Headless components (Composition, HeroVideo) | ✅ shipped |
| **Admin components (BackdropAdmin, CompositorAdmin, CompositorRender)** | ⏸ deferred to v0.2.1 — paired with consumer adoption tests |
| **Backdrop video route (Kling poller adapter)** | ⏸ v0.2.1 |
| **Backdrop stitch route (ffmpeg adapter)** | ⏸ v0.2.1 |
| **Backdrop archive route (ArchiveStore)** | ⏸ v0.2.1 |
| **Backdrop transformImage route (Fal AI adapter)** | ⏸ v0.2.1 |
| **Backdrop backfillAnchors / writeProject** | ⏸ v0.2.1 (RWS-specific use cases) |
| **Compositor bake route (Playwright + ffmpeg)** | ⏸ v0.2.1 |

Spec card: wikiTaTa `bc951384`. Style canon: card `68c40443` (Steel blue).

## Install

```sh
pnpm add @wikitata/content-creation@^0.2.0
```

Peer deps: `react@>=18`, `react-dom@>=18` (only for component subpath; routes work without React).

## Quick start — wiring routes in Next.js App Router

```ts
// src/lib/cc.ts
import {
  FsAdapter,
  VercelAIGatewayAdapter,
  JsonSpecStore,
  JsonCompositionStore,
  SupabaseCostLogStore,
  SupabaseGenLogStore,
  SupabaseBatchSpendLogStore,
  createBackdropRoutes,
  createCompositorRoutes,
} from '@wikitata/content-creation';
import path from 'node:path';
import { wt_vault_inject_to_env } from '@/lib/vault'; // your vault helper

const storage = new FsAdapter({
  baseDir: path.join(process.cwd(), 'public/generated'),
  urlPrefix: '/generated',
});

const ai = new VercelAIGatewayAdapter({
  apiKey: () => wt_vault_inject_to_env('AI_GATEWAY_API_KEY'),
});

const specStore = new JsonSpecStore({
  storage,
  defaultSpec: () => ({ /* your seed anchors + segments */ }),
});

const compositionStore = new JsonCompositionStore({ storage });

const supabase = await getSupabaseServer();
const costLog = new SupabaseCostLogStore({ client: supabase, table: 'cost_log' });
const genLog = new SupabaseGenLogStore({ client: supabase, table: 'gen_log' });
const batchSpendLog = new SupabaseBatchSpendLogStore({ client: supabase, table: 'batch_spend_log' });

const auth = {
  async requireAdmin(req: Request) {
    const sb = await getSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user || !isAdminEmail(user.email)) throw new Error('forbidden');
    return user;
  },
};

const env = {
  isLocalOnlyAllowed: () => !process.env.VERCEL,
  get: (k: string) => process.env[k],
};

export const backdropRoutes = createBackdropRoutes({
  storage, ai, auth, env,
  specStore, costLog, genLog, batchSpendLog,
  imageModel: 'bfl/flux-pro-1.1-ultra',
  chatModel: 'anthropic/claude-haiku-4-5',
  aspect: { width: 1920, height: 1080 },
  project: 'rws',
});

export const compositorRoutes = createCompositorRoutes({
  storage, ai, auth, env,
  compositionStore,
  assetPrefix: 'assets',
});
```

```ts
// src/app/api/admin/gen/anchor/route.ts
import { backdropRoutes } from '@/lib/cc';
export const POST = backdropRoutes.anchor.POST;
```

```ts
// src/app/api/admin/compositor/[id]/route.ts
import { compositorRoutes } from '@/lib/cc';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return compositorRoutes.byId.GET(id)(req);
}
```

## Subpath exports

| Subpath | Contents |
|---|---|
| `@wikitata/content-creation` | All public exports (root barrel) |
| `@wikitata/content-creation/components` | `Composition`, `HeroVideo` |
| `@wikitata/content-creation/routes` | Route factories + helpers (`jsonResponse`, `errorResponse`, `withAdmin`) |
| `@wikitata/content-creation/adapters` | Storage + AI adapters |
| `@wikitata/content-creation/migrations` | `runMigrations`, `SqlRunner` |

## Migrations

```ts
import { runMigrations } from '@wikitata/content-creation/migrations';

await runMigrations({
  schema: 'wikitata',
  runner: {
    async exec(sql) { await pool.query(sql); },
    async query(sql) { const r = await pool.query(sql); return r.rows; },
  },
});
```

Creates `cost_log`, `gen_log`, `batch_spend_log` tables in the target schema (idempotent). Tracks state in `<schema>.cc_migrations`.

## Style

Components ship headless. Apply Steel-blue token canon (wikiTaTa card `68c40443`) at the consumer level via container className + CSS vars.

## Versioning + parity

Semver. Parity discipline (per spec card `bc951384`):

- ✅ All edits land in this package via PR.
- ✅ Consumers pin via caret (`^0.x.x`) for additive updates.
- ❌ Banned: editing inside consumer `node_modules` or copy-pasting "for now."
- ❌ Banned: divergent forks "to test in repo X first" — feature-flag inside the package.

## Source provenance

Initial code lifted from `~/git/readings-with-scot` HEAD `b330f7d` (2026-05-05).
See `CHANGELOG.md` for per-step lift history.
