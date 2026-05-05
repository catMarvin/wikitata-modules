import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FsAdapter } from './storage-fs.js';
import { assertSafePath } from './storage.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-adapter-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('FsAdapter', () => {
  it('write + read round-trip', async () => {
    const a = new FsAdapter({ baseDir: tmpDir });
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await a.writeFile('sub/dir/file.bin', data);
    const out = await a.readFile('sub/dir/file.bin');
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('exists() before/after write', async () => {
    const a = new FsAdapter({ baseDir: tmpDir });
    expect(await a.exists('foo.txt')).toBe(false);
    await a.writeFile('foo.txt', new Uint8Array([0]));
    expect(await a.exists('foo.txt')).toBe(true);
  });

  it('listDir returns FileInfo[] with sizes', async () => {
    const a = new FsAdapter({ baseDir: tmpDir });
    await a.writeFile('a.bin', new Uint8Array([0, 1]));
    await a.writeFile('b.bin', new Uint8Array([0, 1, 2]));
    const files = (await a.listDir('.')).sort((x, y) => x.path.localeCompare(y.path));
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe('a.bin');
    expect(files[0]?.size).toBe(2);
    expect(files[1]?.size).toBe(3);
  });

  it('deleteFile is idempotent', async () => {
    const a = new FsAdapter({ baseDir: tmpDir });
    await a.deleteFile('does-not-exist.txt'); // should not throw
    await a.writeFile('x', new Uint8Array([0]));
    await a.deleteFile('x');
    expect(await a.exists('x')).toBe(false);
  });

  it('copyFile creates target parents', async () => {
    const a = new FsAdapter({ baseDir: tmpDir });
    await a.writeFile('src.bin', new Uint8Array([9]));
    await a.copyFile('src.bin', 'nested/dst.bin');
    const out = await a.readFile('nested/dst.bin');
    expect(out[0]).toBe(9);
  });

  it('publicUrl applies urlPrefix', () => {
    const a = new FsAdapter({ baseDir: tmpDir, urlPrefix: '/generated' });
    expect(a.publicUrl('anchor/1.png')).toBe('/generated/anchor/1.png');
    const b = new FsAdapter({ baseDir: tmpDir });
    expect(b.publicUrl('anchor/1.png')).toBe('/anchor/1.png');
  });

  it('rejects path traversal', async () => {
    const a = new FsAdapter({ baseDir: tmpDir });
    await expect(a.readFile('../escape')).rejects.toThrow(/must not contain/);
    await expect(a.writeFile('/abs', new Uint8Array([0]))).rejects.toThrow(/relative/);
    expect(() => assertSafePath('a/../b')).toThrow();
  });

  it('throws on non-absolute baseDir', () => {
    expect(() => new FsAdapter({ baseDir: 'rel/path' })).toThrow(/absolute/);
  });
});
