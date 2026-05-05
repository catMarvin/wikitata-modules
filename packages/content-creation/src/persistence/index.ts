/**
 * Persistence barrel — Spec store today; cost log + render log + DB-backed
 * variants land in step 7.
 */

export { JsonSpecStore, type SpecStore, type JsonSpecStoreConfig } from './spec-store.js';
export {
  JsonCompositionStore,
  type CompositionStore,
  type JsonCompositionStoreConfig,
} from './composition-store.js';

export type {
  CostLogEntry,
  CostLogStore,
  GenLogEntry,
  GenLogRow,
  GenLogStore,
  BatchSpendLogEntry,
  BatchSpendLogRow,
  BatchSpendLogStore,
} from './cost-log.js';

export {
  NoopCostLogStore,
  NoopGenLogStore,
  NoopBatchSpendLogStore,
} from './cost-log.js';

export {
  SupabaseCostLogStore,
  SupabaseGenLogStore,
  SupabaseBatchSpendLogStore,
  type SupabaseCostLogStoreConfig,
  type SupabaseGenLogStoreConfig,
  type SupabaseBatchSpendLogStoreConfig,
  type MinimalSupabaseClient,
} from './cost-log-supabase.js';
