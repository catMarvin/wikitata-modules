/**
 * Supabase-backed implementations of CostLog / GenLog / BatchSpendLog.
 *
 * Consumer provides a Supabase client + table names. Defaults match RWS:
 *   cost_log_table:    'cost_log'
 *   gen_log_table:     'hero_gen_log'
 *   batch_log_table:   'hero_batch_spend_log'
 *
 * For wikitata, table names are different (e.g. `backdrop_cost_log`).
 */

import type {
  BatchSpendLogEntry,
  BatchSpendLogRow,
  BatchSpendLogStore,
  CostLogEntry,
  CostLogStore,
  GenLogEntry,
  GenLogRow,
  GenLogStore,
} from './cost-log.js';

interface SupabasePostgrestQuery<TRow> {
  select(cols: string): SupabasePostgrestQuery<TRow>;
  insert(rows: object | object[]): Promise<{ error: { message: string } | null }>;
  update(values: object, options?: { count?: 'exact' }): SupabasePostgrestQuery<TRow>;
  order(col: string, opts?: { ascending: boolean }): SupabasePostgrestQuery<TRow>;
  limit(n: number): SupabasePostgrestQuery<TRow>;
  eq(col: string, val: unknown): SupabasePostgrestQuery<TRow>;
  lte(col: string, val: unknown): SupabasePostgrestQuery<TRow>;
  then(onFulfilled: (v: { data: TRow[] | null; error: { message: string } | null; count?: number | null }) => void): Promise<void>;
}

export interface MinimalSupabaseClient {
  from<TRow = Record<string, unknown>>(table: string): SupabasePostgrestQuery<TRow>;
}

export interface SupabaseCostLogStoreConfig {
  client: MinimalSupabaseClient;
  table?: string;
}

export class SupabaseCostLogStore implements CostLogStore {
  private readonly client: MinimalSupabaseClient;
  private readonly table: string;

  constructor(config: SupabaseCostLogStoreConfig) {
    this.client = config.client;
    this.table = config.table ?? 'cost_log';
  }

  async append(entry: CostLogEntry): Promise<void> {
    const row = {
      msg: entry.msg,
      ok: entry.ok,
      cost_usd: entry.cost_usd,
      model: entry.model,
      cost_source: entry.cost_source,
      project: entry.project ?? null,
      route: entry.route ?? null,
      provider: entry.provider ?? null,
      native_unit: entry.native_unit ?? null,
      native_amount: entry.native_amount ?? null,
    };
    const { error } = await this.client.from(this.table).insert(row);
    if (error) throw new Error(`SupabaseCostLogStore.append: ${error.message}`);
  }
}

export interface SupabaseGenLogStoreConfig {
  client: MinimalSupabaseClient;
  table?: string;
}

export class SupabaseGenLogStore implements GenLogStore {
  private readonly client: MinimalSupabaseClient;
  private readonly table: string;

  constructor(config: SupabaseGenLogStoreConfig) {
    this.client = config.client;
    this.table = config.table ?? 'hero_gen_log';
  }

  async append(entry: GenLogEntry): Promise<void> {
    const row = {
      msg: entry.msg.slice(0, 2000),
      ok: typeof entry.ok === 'boolean' ? entry.ok : null,
      session_id: entry.sessionId ?? null,
      ts: entry.ts ? new Date(entry.ts).toISOString() : new Date().toISOString(),
    };
    const { error } = await this.client.from(this.table).insert(row);
    if (error) throw new Error(`SupabaseGenLogStore.append: ${error.message}`);
  }

  async list(opts: { limit: number; showArchived: boolean }): Promise<GenLogRow[]> {
    let q = this.client
      .from<GenLogRow>(this.table)
      .select('id, ts, msg, ok, archived')
      .order('ts', { ascending: false })
      .limit(opts.limit);
    if (!opts.showArchived) q = q.eq('archived', false);
    const out = await new Promise<{ data: GenLogRow[] | null; error: { message: string } | null }>((resolve) => {
      q.then((r) => resolve(r));
    });
    if (out.error) throw new Error(`SupabaseGenLogStore.list: ${out.error.message}`);
    return out.data ?? [];
  }

  async archiveBefore(beforeIso: string): Promise<{ archivedCount: number }> {
    const out = await new Promise<{ data: GenLogRow[] | null; error: { message: string } | null; count?: number | null }>(
      (resolve) => {
        this.client
          .from<GenLogRow>(this.table)
          .update({ archived: true }, { count: 'exact' })
          .eq('archived', false)
          .lte('ts', beforeIso)
          .then((r) => resolve(r));
      },
    );
    if (out.error) throw new Error(`SupabaseGenLogStore.archiveBefore: ${out.error.message}`);
    return { archivedCount: out.count ?? 0 };
  }
}

export interface SupabaseBatchSpendLogStoreConfig {
  client: MinimalSupabaseClient;
  table?: string;
}

export class SupabaseBatchSpendLogStore implements BatchSpendLogStore {
  private readonly client: MinimalSupabaseClient;
  private readonly table: string;

  constructor(config: SupabaseBatchSpendLogStoreConfig) {
    this.client = config.client;
    this.table = config.table ?? 'hero_batch_spend_log';
  }

  async append(entry: BatchSpendLogEntry): Promise<void> {
    const row = {
      ts: entry.ts ? new Date(entry.ts).toISOString() : new Date().toISOString(),
      seg_indices: entry.segIndices,
      seg_labels: entry.segLabels,
      ok_count: entry.okCount ?? 0,
      err_count: entry.errCount ?? 0,
      cost_measured: entry.costMeasured ?? null,
      cost_estimate: entry.costEstimate ?? 0,
      balance_before: entry.balanceBefore ?? null,
      balance_after: entry.balanceAfter ?? null,
      model: entry.model ?? null,
    };
    const { error } = await this.client.from(this.table).insert(row);
    if (error) throw new Error(`SupabaseBatchSpendLogStore.append: ${error.message}`);
  }

  async list(limit: number): Promise<BatchSpendLogRow[]> {
    const out = await new Promise<{ data: BatchSpendLogRow[] | null; error: { message: string } | null }>((resolve) => {
      this.client
        .from<BatchSpendLogRow>(this.table)
        .select('id, ts, seg_indices, seg_labels, ok_count, err_count, cost_measured, cost_estimate, balance_before, balance_after, model')
        .order('ts', { ascending: false })
        .limit(limit)
        .then((r) => resolve(r));
    });
    if (out.error) throw new Error(`SupabaseBatchSpendLogStore.list: ${out.error.message}`);
    return out.data ?? [];
  }
}
