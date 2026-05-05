/**
 * SpecStore — load/save the Backdrop Spec backed by a StorageAdapter.
 *
 * v0.2.0 ships the JSON-on-StorageAdapter variant: a single JSON document
 * stored at a configured path (default `spec.json`). The DB-backed variant
 * (rows in `backdrop_*` tables) lands in step 7 as a sibling implementation
 * of the same `SpecStore` interface.
 */

import type { StorageAdapter } from '../adapters/storage.js';
import {
  assertValidSpec,
  defaultBridgePrompt,
  rebuildSegments,
  type Spec,
  type SpecAnchor,
  type SpecSegment,
} from '../lib/spec.js';

export interface SpecStore {
  load(): Promise<Spec>;
  save(spec: Spec): Promise<void>;
  /** Convenience: rebuild segments to match anchor order, then save. */
  saveAndRebuild(spec: Spec): Promise<Spec>;
}

export interface JsonSpecStoreConfig {
  storage: StorageAdapter;
  /** Storage path for the JSON document. Default: 'spec.json'. */
  path?: string;
  /**
   * If the spec is missing on first load, seed from this factory. The default
   * factory throws — every consumer should supply project-specific seed
   * anchors (RWS uses `bg-spec.ts` ANCHORS / SEGMENTS).
   */
  defaultSpec?: () => Spec;
  /** Optional override for bridge-prompt generation when rebuilding segments. */
  bridgePrompt?: (a: SpecAnchor, b: SpecAnchor) => string;
}

export class JsonSpecStore implements SpecStore {
  private readonly storage: StorageAdapter;
  private readonly path: string;
  private readonly defaultFactory: () => Spec;
  private readonly bridgePrompt: (a: SpecAnchor, b: SpecAnchor) => string;

  constructor(config: JsonSpecStoreConfig) {
    this.storage = config.storage;
    this.path = config.path ?? 'spec.json';
    this.defaultFactory =
      config.defaultSpec ??
      (() => {
        throw new Error('JsonSpecStore: spec missing and no defaultSpec factory configured');
      });
    this.bridgePrompt = config.bridgePrompt ?? defaultBridgePrompt;
  }

  async load(): Promise<Spec> {
    if (!(await this.storage.exists(this.path))) {
      const seeded = this.defaultFactory();
      assertValidSpec(seeded);
      await this.save(seeded);
      return seeded;
    }
    const bytes = await this.storage.readFile(this.path);
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text);
    assertValidSpec(parsed);
    return parsed;
  }

  async save(spec: Spec): Promise<void> {
    assertValidSpec(spec);
    const text = JSON.stringify(spec, null, 2);
    await this.storage.writeFile(this.path, new TextEncoder().encode(text));
  }

  async saveAndRebuild(spec: Spec): Promise<Spec> {
    const rebuilt = rebuildSegments(spec, this.bridgePrompt);
    await this.save(rebuilt);
    return rebuilt;
  }
}

// Re-export Spec types from the canonical home for ergonomic imports.
export type { Spec, SpecAnchor, SpecSegment } from '../lib/spec.js';
