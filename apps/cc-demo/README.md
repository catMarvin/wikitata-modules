# @wikitata/cc-demo

Wikitata-side adoption demo for `@wikitata/content-creation`.

## Purpose

Proves the wikitata adoption story end-to-end inside the same monorepo as the
package. Demonstrates:

- pnpm workspace installation (`workspace:*` dep)
- Adapter wiring (storage / AI / auth / env)
- Route mounting under the canonical `/content-creation/{video-designer,compositor}/...` URL shape (per spec card `bc951384`)
- Steel-blue token canon application at `:root` (per style card `68c40443`)
- Headless package introspection (`VERSION`, `STATUS`)

## Status

`v0.0.1` — minimal proof-of-mount. Routes are wired with an always-deny
`AuthAdapter`, so they return `403 forbidden`. The point is the wiring, not
the runtime exercise.

## Run

```sh
pnpm install                           # at workspace root
cd apps/cc-demo
pnpm dev                               # localhost:3000
```

## What's NOT in v0.0.1

- Real auth (always-deny stub)
- Real AI Gateway key (placeholder)
- Real Supabase Storage adapter (uses local `.cc-demo-data/` FS)
- Admin UI (waiting on v0.2.1 of `@wikitata/content-creation`)
- Vercel deployment config

## Path to wikitata.com

When wikitata.com is ready to host the Content Creation surface:

1. Promote this demo to a sibling production app (e.g. `apps/wikitata-cc/`).
2. Swap FsAdapter → SupabaseStorageAdapter against a `backdrop` bucket.
3. Wire real auth (Sign-in-with-Vercel or Supabase Auth).
4. Inject AI Gateway key via vault.
5. Apply migrations: `runMigrations({schema: 'wikitata', runner})`.
6. Deploy as its own Vercel project; expose at `cc.wikitata.com` or as a route on the main wikitata Vercel project.
