/**
 * StorageAdapter — abstracts the file-storage layer used by the Backdrop
 * pipeline (anchor images, segment videos, stitched output, posters) and the
 * Compositor (uploaded assets, baked frames, output mp4).
 *
 * Two reference implementations ship with the package:
 *   - FsAdapter — Node `fs/promises` against a configured base dir. Used by
 *     RWS (current) and any local-dev workflow that wants on-disk parity.
 *   - SupabaseStorageAdapter — Supabase Storage bucket. Used by wikitata and
 *     any multi-tenant deployment.
 *
 * Both adapters implement the same contract; consumers pick at construction.
 *
 * Path semantics: paths are POSIX-style relative paths within the adapter's
 * configured root (FS: a base directory; Supabase: a bucket). Adapters MUST
 * normalize and reject path traversal (`..` segments, absolute paths).
 */

export type FileBytes = Uint8Array | Buffer;

export interface FileInfo {
  /** POSIX-style path relative to adapter root. */
  path: string;
  /** Bytes (omitted by listDir for performance). */
  size: number;
  /** Last-modified epoch millis. */
  mtimeMs: number;
}

export interface StorageAdapter {
  /** Read full file contents. Throws if missing. */
  readFile(path: string): Promise<Uint8Array>;

  /** Write file contents. Creates parent directories as needed. Overwrites. */
  writeFile(path: string, data: FileBytes): Promise<void>;

  /** Delete a single file. No-op if missing (does not throw). */
  deleteFile(path: string): Promise<void>;

  /** Copy src → dst. dst is overwritten. */
  copyFile(src: string, dst: string): Promise<void>;

  /** Existence check. Never throws. */
  exists(path: string): Promise<boolean>;

  /** File metadata. Throws if missing. */
  stat(path: string): Promise<FileInfo>;

  /**
   * List the immediate children of a directory (non-recursive).
   * Returns POSIX-style paths relative to adapter root.
   * For Supabase Storage, "directory" is the path prefix.
   */
  listDir(dirPath: string): Promise<FileInfo[]>;

  /**
   * Resolve a public-facing URL the consumer can hand to a browser <img> /
   * <video> tag. For FS adapters mounted under a Next.js public dir, this is
   * a relative URL (e.g. "/generated/anchor-1.png"). For Supabase Storage,
   * either a public-bucket URL or a signed URL depending on adapter config.
   */
  publicUrl(path: string): string;
}

/**
 * Reject path traversal at the adapter boundary. Both built-in adapters call
 * this on every input path.
 */
export function assertSafePath(p: string): void {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error('storage path must be a non-empty string');
  }
  if (p.startsWith('/') || p.startsWith('\\')) {
    throw new Error(`storage path must be relative: got "${p}"`);
  }
  const segments = p.split(/[\\/]+/);
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`storage path must not contain "${seg}" segments: "${p}"`);
    }
    if (/^[A-Za-z]:$/.test(seg)) {
      throw new Error(`storage path must not contain drive letters: "${p}"`);
    }
  }
}
