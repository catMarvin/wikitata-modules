/**
 * FsAdapter — StorageAdapter against Node `fs/promises` rooted at a base dir.
 *
 * Use case: RWS local + production (writes to ./public/generated/...), and any
 * single-tenant deployment that wants on-disk artifacts alongside the app.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  assertSafePath,
  type FileBytes,
  type FileInfo,
  type StorageAdapter,
} from './storage.js';

export interface FsAdapterConfig {
  /** Absolute path to the directory all paths resolve under. */
  baseDir: string;
  /**
   * Optional: prefix applied to publicUrl() results. e.g. for files written
   * under `<projectRoot>/public/generated/` and served at `/generated/...`,
   * pass `urlPrefix: '/generated'`.
   */
  urlPrefix?: string;
}

export class FsAdapter implements StorageAdapter {
  private readonly baseDir: string;
  private readonly urlPrefix: string;

  constructor(config: FsAdapterConfig) {
    if (!path.isAbsolute(config.baseDir)) {
      throw new Error(`FsAdapter.baseDir must be absolute: "${config.baseDir}"`);
    }
    this.baseDir = config.baseDir;
    this.urlPrefix = (config.urlPrefix ?? '').replace(/\/$/, '');
  }

  private resolve(p: string): string {
    assertSafePath(p);
    return path.join(this.baseDir, p);
  }

  async readFile(p: string): Promise<Uint8Array> {
    const buf = await fs.readFile(this.resolve(p));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async writeFile(p: string, data: FileBytes): Promise<void> {
    const full = this.resolve(p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }

  async deleteFile(p: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(p));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async copyFile(src: string, dst: string): Promise<void> {
    const srcFull = this.resolve(src);
    const dstFull = this.resolve(dst);
    await fs.mkdir(path.dirname(dstFull), { recursive: true });
    await fs.copyFile(srcFull, dstFull);
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(p));
      return true;
    } catch {
      return false;
    }
  }

  async stat(p: string): Promise<FileInfo> {
    const s = await fs.stat(this.resolve(p));
    return { path: p, size: s.size, mtimeMs: s.mtimeMs };
  }

  async listDir(dirPath: string): Promise<FileInfo[]> {
    const isRoot = dirPath === '' || dirPath === '.';
    if (!isRoot) assertSafePath(dirPath);
    const full = isRoot ? this.baseDir : path.join(this.baseDir, dirPath);
    const entries = await fs.readdir(full, { withFileTypes: true });
    const out: FileInfo[] = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const relDir = isRoot ? '' : dirPath.replace(/\\/g, '/');
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const s = await fs.stat(path.join(full, e.name));
      out.push({ path: rel, size: s.size, mtimeMs: s.mtimeMs });
    }
    return out;
  }

  publicUrl(p: string): string {
    assertSafePath(p);
    const norm = p.replace(/\\/g, '/').replace(/^\/+/, '');
    return this.urlPrefix ? `${this.urlPrefix}/${norm}` : `/${norm}`;
  }
}
