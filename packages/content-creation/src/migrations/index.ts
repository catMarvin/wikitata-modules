/**
 * Migration runner.
 *
 * v0.2.0 ships a single migration:
 *   - v0_2_0__initial.sql: cost_log, gen_log, batch_spend_log tables
 *
 * Future additions are appended in chronological filename order. The runner
 * tracks applied migrations in `<schema>.cc_migrations`.
 *
 * The package does NOT bundle a SQL client — consumer supplies a runner
 * function that executes a single SQL statement. This avoids pinning to
 * specific Postgres clients (pg, postgres, supabase, etc.).
 */

import v0_2_0__initial from './v0_2_0__initial.sql.js';

const MIGRATIONS = [
  { name: 'v0.2.0__initial', sql: v0_2_0__initial },
];

export interface SqlRunner {
  /** Execute a single multi-statement SQL string. May throw. */
  exec(sql: string): Promise<void>;
  /** Execute a query returning rows. */
  query<TRow = Record<string, unknown>>(sql: string): Promise<TRow[]>;
}

export interface RunMigrationsOptions {
  /** Target schema (e.g. 'wikitata' for wikitata, 'public' for RWS). */
  schema: string;
  /** Consumer-supplied SQL runner. */
  runner: SqlRunner;
  /** Optional log sink. */
  log?: (msg: string) => void;
}

export async function runMigrations(opts: RunMigrationsOptions): Promise<{ applied: string[]; skipped: string[] }> {
  const log = opts.log ?? (() => {});
  const { schema, runner } = opts;

  // Bookkeeping table.
  await runner.exec(`
    CREATE SCHEMA IF NOT EXISTS ${schema};
    CREATE TABLE IF NOT EXISTS ${schema}.cc_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const appliedRows = await runner.query<{ name: string }>(
    `SELECT name FROM ${schema}.cc_migrations`,
  );
  const appliedSet = new Set(appliedRows.map((r) => r.name));

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.name)) {
      skipped.push(m.name);
      log(`[content-creation] migration skipped (already applied): ${m.name}`);
      continue;
    }
    const sql = m.sql.replace(/__SCHEMA__/g, schema);
    log(`[content-creation] applying migration: ${m.name}`);
    await runner.exec(sql);
    await runner.exec(
      `INSERT INTO ${schema}.cc_migrations (name) VALUES ('${m.name.replace(/'/g, "''")}');`,
    );
    applied.push(m.name);
  }
  return { applied, skipped };
}
