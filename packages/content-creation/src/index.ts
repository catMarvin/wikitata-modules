// @wikitata/content-creation — root export
//
// Genericization in progress. Each export below corresponds to a baseline
// file that has been promoted out of src/_baseline-rws/ into its real home.
// See spec card bc951384 + CHANGELOG.md.

export const VERSION = '0.2.0-step3' as const;
export const STATUS = 'genericizing' as const;

// Adapters — storage today; AI + DB in later steps.
export type {
  StorageAdapter,
  FileInfo,
  FileBytes,
  FsAdapterConfig,
  SupabaseStorageAdapterConfig,
  MinimalSupabaseStorageClient,
} from './adapters/index.js';

export {
  FsAdapter,
  SupabaseStorageAdapter,
  assertSafePath,
} from './adapters/index.js';

// Schema — framework-agnostic types describing compositions, layers, transitions.
export type {
  Box,
  Transition,
  TransitionKind,
  Layer,
  TextLayer,
  ImageLayer,
  VideoLayer,
  Composition,
} from './lib/composition.js';

export {
  aspectRatioToNumber,
  effectiveOpacity,
  transitionStyle,
  seedCompositions,
} from './lib/composition.js';
