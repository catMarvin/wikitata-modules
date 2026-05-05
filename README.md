# wikitata-modules

Shared module library for the wikiTaTa ecosystem.

This is a **pnpm workspace** repo. Packages here are consumed by multiple
wikiTaTa-family projects (wikitata core, readings-with-scot, laughing-monk-cafe,
crown, future tenants) with bi-directional parity: edits land here as PRs;
consumers pull updates via semver. **No copy-paste forks.**

## Canonical references

- Module Resource Library spec: wikiTaTa card `e10d895e`
- Canonical extraction pattern (this repo): wikiTaTa card `bc951384`
- Style canon for any UI ships from here: wikiTaTa card `68c40443` (Steel blue, Inter+Share Tech Mono, `.step-row`)

## Packages

| Package | Status | Description |
|---|---|---|
| `@wikitata/content-creation` | v0.1.0 baseline (scaffolded 2026-05-05) | Video Designer (AI-describe → render → blend video pipeline) + Compositor (layered titling/composition over rendered video) |

## Layout

```
packages/
  content-creation/
    src/
      lib/        — schemas + renderer (framework-agnostic core)
      components/ — headless React components
      routes/     — route factory functions (mountable under any prefix)
      adapters/   — storage (FS, Supabase Storage), AI (Vercel Gateway), DB
      migrations/ — SQL migrations runnable via runMigrations()
    README.md
    CHANGELOG.md
    package.json
```

## Adoption

Consumers add the package as a workspace dep (preferred when both repos live in
the same monorepo) or via GitHub Packages registry pin (current default while
projects remain in separate repos).

```sh
pnpm add @wikitata/content-creation@^0.1.0
```

Then mount routes + components per package README.

## Parity discipline

- ✅ All edits to a published package land here, in a PR.
- ✅ Consumers pin semver and update via `pnpm update`.
- ❌ Banned: editing files inside consumer `node_modules` or copy-pasting "for now."
- ❌ Banned: divergent forks of the same component "to test in repo X first" — feature-flag inside the package instead.

PR template asks "Does this need to ship to all consumers?" as a required field.

## Versioning

Semver. Breaking changes (schema migrations, removed exports, rebranded class
names) require a major bump and a `MIGRATION.md` entry in the affected package.
