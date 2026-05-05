/**
 * Adapters barrel — storage today; AI + DB land in step 3 / step 7.
 */

export type {
  StorageAdapter,
  FileInfo,
  FileBytes,
} from './storage.js';

export { assertSafePath } from './storage.js';

export { FsAdapter, type FsAdapterConfig } from './storage-fs.js';

export {
  SupabaseStorageAdapter,
  type SupabaseStorageAdapterConfig,
  type MinimalSupabaseStorageClient,
} from './storage-supabase.js';

export type {
  AIAdapter,
  ImageGenerateParams,
  ImageGenerateResult,
  VideoGenerateParams,
  VideoGenerateResult,
  ChatMessage,
  ChatGenerateParams,
  ChatGenerateResult,
  UsageReport,
  ModelEntry,
  MeasuredResult,
} from './ai.js';

export {
  VercelAIGatewayAdapter,
  type VercelAIGatewayAdapterConfig,
} from './ai-vercel-gateway.js';
