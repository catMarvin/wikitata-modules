/**
 * SupabaseStorageAdapter — StorageAdapter backed by a Supabase Storage bucket.
 *
 * Use case: wikitata + any multi-tenant deployment. Bucket may be public or
 * private; for private buckets, publicUrl() returns a freshly-signed URL with
 * the configured TTL.
 *
 * The consumer provides the Supabase client (so this package doesn't pin a
 * specific @supabase/supabase-js version). The minimal interface required is
 * captured in `MinimalSupabaseStorageClient` below.
 */

import {
  assertSafePath,
  type FileBytes,
  type FileInfo,
  type StorageAdapter,
} from './storage.js';

interface SupabaseFileObject {
  name: string;
  metadata?: { size?: number; mimetype?: string; lastModified?: string } | null;
  updated_at?: string | null;
  created_at?: string | null;
}

interface SupabaseStorageBucketAPI {
  upload(path: string, body: Blob | ArrayBuffer | Uint8Array | Buffer, options?: { upsert?: boolean; contentType?: string }): Promise<{ data: unknown; error: { message: string } | null }>;
  download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
  copy(from: string, to: string): Promise<{ data: unknown; error: { message: string } | null }>;
  list(path?: string, options?: { limit?: number; offset?: number }): Promise<{ data: SupabaseFileObject[] | null; error: { message: string } | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  createSignedUrl(path: string, expiresInSec: number): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
}

export interface MinimalSupabaseStorageClient {
  storage: { from(bucket: string): SupabaseStorageBucketAPI };
}

export interface SupabaseStorageAdapterConfig {
  client: MinimalSupabaseStorageClient;
  bucket: string;
  /**
   * If true, publicUrl() uses getPublicUrl(); else createSignedUrl(). Default: false.
   */
  isPublicBucket?: boolean;
  /** TTL in seconds for signed URLs when bucket is private. Default: 3600. */
  signedUrlTtlSec?: number;
}

export class SupabaseStorageAdapter implements StorageAdapter {
  private readonly bucket: SupabaseStorageBucketAPI;
  private readonly isPublic: boolean;
  private readonly ttl: number;

  constructor(config: SupabaseStorageAdapterConfig) {
    this.bucket = config.client.storage.from(config.bucket);
    this.isPublic = config.isPublicBucket ?? false;
    this.ttl = config.signedUrlTtlSec ?? 3600;
  }

  private static toUint8(data: Blob | null): Promise<Uint8Array> {
    if (!data) throw new Error('SupabaseStorageAdapter.readFile: empty body');
    return data.arrayBuffer().then((b) => new Uint8Array(b));
  }

  async readFile(p: string): Promise<Uint8Array> {
    assertSafePath(p);
    const { data, error } = await this.bucket.download(p);
    if (error) throw new Error(`SupabaseStorageAdapter.readFile(${p}): ${error.message}`);
    return SupabaseStorageAdapter.toUint8(data);
  }

  async writeFile(p: string, data: FileBytes): Promise<void> {
    assertSafePath(p);
    const { error } = await this.bucket.upload(p, data, { upsert: true });
    if (error) throw new Error(`SupabaseStorageAdapter.writeFile(${p}): ${error.message}`);
  }

  async deleteFile(p: string): Promise<void> {
    assertSafePath(p);
    const { error } = await this.bucket.remove([p]);
    if (error) throw new Error(`SupabaseStorageAdapter.deleteFile(${p}): ${error.message}`);
  }

  async copyFile(src: string, dst: string): Promise<void> {
    assertSafePath(src);
    assertSafePath(dst);
    const { error } = await this.bucket.copy(src, dst);
    if (error) throw new Error(`SupabaseStorageAdapter.copyFile(${src} → ${dst}): ${error.message}`);
  }

  async exists(p: string): Promise<boolean> {
    assertSafePath(p);
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    const { data, error } = await this.bucket.list(dir);
    if (error) return false;
    return (data ?? []).some((entry) => entry.name === name);
  }

  async stat(p: string): Promise<FileInfo> {
    assertSafePath(p);
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    const { data, error } = await this.bucket.list(dir);
    if (error) throw new Error(`SupabaseStorageAdapter.stat(${p}): ${error.message}`);
    const match = (data ?? []).find((entry) => entry.name === name);
    if (!match) throw new Error(`SupabaseStorageAdapter.stat(${p}): not found`);
    const sizeRaw = match.metadata?.size ?? 0;
    const updatedAt = match.updated_at ?? match.metadata?.lastModified ?? null;
    return {
      path: p,
      size: sizeRaw,
      mtimeMs: updatedAt ? Date.parse(updatedAt) : 0,
    };
  }

  async listDir(dirPath: string): Promise<FileInfo[]> {
    if (dirPath !== '') assertSafePath(dirPath);
    const { data, error } = await this.bucket.list(dirPath);
    if (error) throw new Error(`SupabaseStorageAdapter.listDir(${dirPath}): ${error.message}`);
    return (data ?? [])
      .filter((entry) => entry.metadata)
      .map((entry) => ({
        path: dirPath ? `${dirPath}/${entry.name}` : entry.name,
        size: entry.metadata?.size ?? 0,
        mtimeMs: entry.updated_at ? Date.parse(entry.updated_at) : 0,
      }));
  }

  publicUrl(p: string): string {
    assertSafePath(p);
    if (this.isPublic) {
      const { data } = this.bucket.getPublicUrl(p);
      return data.publicUrl;
    }
    throw new Error(
      'SupabaseStorageAdapter.publicUrl(): bucket is private; use signedUrl() async path instead',
    );
  }

  /** Async signed-URL helper. Use when bucket is private. */
  async signedUrl(p: string, ttlSec?: number): Promise<string> {
    assertSafePath(p);
    const { data, error } = await this.bucket.createSignedUrl(p, ttlSec ?? this.ttl);
    if (error || !data) throw new Error(`SupabaseStorageAdapter.signedUrl(${p}): ${error?.message ?? 'no data'}`);
    return data.signedUrl;
  }
}
