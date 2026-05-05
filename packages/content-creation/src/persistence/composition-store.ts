/**
 * CompositionStore — load / list / upsert / remove compositions.
 *
 * v0.2.0 ships JsonCompositionStore: a single JSON document stored at a
 * configurable path (default `compositions.json`) via StorageAdapter. Mirrors
 * the SpecStore pattern.
 */

import type { Composition } from '../lib/composition.js';
import type { StorageAdapter } from '../adapters/storage.js';

export interface CompositionStore {
  list(): Promise<Composition[]>;
  get(idOrSlug: string): Promise<Composition | null>;
  upsert(comp: Composition): Promise<Composition>;
  remove(id: string): Promise<void>;
}

export interface JsonCompositionStoreConfig {
  storage: StorageAdapter;
  path?: string;
  /** Default seed factory if the store is empty. Default: () => []. */
  defaultCompositions?: () => Composition[];
}

export class JsonCompositionStore implements CompositionStore {
  private readonly storage: StorageAdapter;
  private readonly path: string;
  private readonly defaultFactory: () => Composition[];

  constructor(config: JsonCompositionStoreConfig) {
    this.storage = config.storage;
    this.path = config.path ?? 'compositions.json';
    this.defaultFactory = config.defaultCompositions ?? (() => []);
  }

  private async readAll(): Promise<Composition[]> {
    if (!(await this.storage.exists(this.path))) {
      const seeded = this.defaultFactory();
      await this.writeAll(seeded);
      return seeded;
    }
    const bytes = await this.storage.readFile(this.path);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(parsed) ? (parsed as Composition[]) : [];
  }

  private async writeAll(comps: Composition[]): Promise<void> {
    const text = JSON.stringify(comps, null, 2);
    await this.storage.writeFile(this.path, new TextEncoder().encode(text));
  }

  async list(): Promise<Composition[]> {
    return this.readAll();
  }

  async get(idOrSlug: string): Promise<Composition | null> {
    const all = await this.readAll();
    return all.find((c) => c.id === idOrSlug || c.slug === idOrSlug) ?? null;
  }

  async upsert(comp: Composition): Promise<Composition> {
    const all = await this.readAll();
    const idx = all.findIndex((c) => c.id === comp.id);
    const next: Composition = { ...comp, updatedAt: Date.now() };
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    await this.writeAll(all);
    return next;
  }

  async remove(id: string): Promise<void> {
    const all = await this.readAll();
    await this.writeAll(all.filter((c) => c.id !== id));
  }
}
