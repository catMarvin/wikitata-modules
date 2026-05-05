/**
 * Cost log + operation log + batch-spend log persistence.
 *
 * Three log streams the Backdrop pipeline writes to:
 *   - CostLog       — fine-grained per-AI-call cost (anchor render, reassess, video, stitch)
 *   - GenLog        — coarse operation-flow log (UI status messages)
 *   - BatchSpendLog — bulk-render summary rows (segIndices + totals)
 *
 * All three abstracted as adapter interfaces. Reference impl is Supabase-backed.
 * Consumers can pass null for any log they don't want to persist (no-op stub).
 */

export interface CostLogEntry {
  msg: string;
  ok: boolean;
  cost_usd: number;
  model: string;
  cost_source: 'measured' | 'estimate';
  project?: string;
  route?: string;
  provider?: string;
  native_unit?: string;
  native_amount?: number;
}

export interface CostLogStore {
  append(entry: CostLogEntry): Promise<void>;
}

export interface GenLogEntry {
  msg: string;
  ok?: boolean | null;
  sessionId?: string | null;
  ts?: number;
}

export interface GenLogRow {
  id: number | string;
  ts: string;
  msg: string;
  ok: boolean | null;
  archived: boolean;
}

export interface GenLogStore {
  append(entry: GenLogEntry): Promise<void>;
  list(opts: { limit: number; showArchived: boolean }): Promise<GenLogRow[]>;
  archiveBefore(beforeIso: string): Promise<{ archivedCount: number }>;
}

export interface BatchSpendLogEntry {
  segIndices: number[];
  segLabels: string[];
  okCount?: number;
  errCount?: number;
  costMeasured?: number | null;
  costEstimate?: number;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  model?: string | null;
  ts?: number;
}

export interface BatchSpendLogRow extends Required<Omit<BatchSpendLogEntry, 'ts'>> {
  id: number | string;
  ts: string;
}

export interface BatchSpendLogStore {
  append(entry: BatchSpendLogEntry): Promise<void>;
  list(limit: number): Promise<BatchSpendLogRow[]>;
}

/** No-op store — useful when a consumer doesn't want to persist a given log stream. */
export const NoopCostLogStore: CostLogStore = { async append() {} };
export const NoopGenLogStore: GenLogStore = {
  async append() {},
  async list() { return []; },
  async archiveBefore() { return { archivedCount: 0 }; },
};
export const NoopBatchSpendLogStore: BatchSpendLogStore = {
  async append() {},
  async list() { return []; },
};
