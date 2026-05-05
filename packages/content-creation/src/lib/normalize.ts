/**
 * Image normalization helpers — center cover-crop + resize to target aspect.
 *
 * Uses `sharp`. Returns the normalized PNG/JPEG bytes alongside dim metadata.
 */

import sharp from 'sharp';

export interface AspectSpec {
  width: number;
  height: number;
}

export interface NormalizeResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** True if input was within 1% of target ratio and no transform was needed. */
  skipped: boolean;
  inputWidth: number;
  inputHeight: number;
}

/**
 * Center cover-crop + resize to exactly `aspect.width x aspect.height`.
 * Re-encodes as PNG for max fidelity (no lossy round-trip).
 */
export async function normalizeToAspect(
  input: Uint8Array | Buffer,
  aspect: AspectSpec,
): Promise<NormalizeResult> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const meta = await sharp(buf).metadata();
  const inW = meta.width ?? 0;
  const inH = meta.height ?? 0;
  const targetRatio = aspect.width / aspect.height;
  const inRatio = inW > 0 && inH > 0 ? inW / inH : targetRatio;
  const mismatch = Math.abs(inRatio - targetRatio) / targetRatio > 0.01;

  if (!mismatch) {
    return {
      bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      width: inW,
      height: inH,
      skipped: true,
      inputWidth: inW,
      inputHeight: inH,
    };
  }

  const out = await sharp(buf)
    .resize(aspect.width, aspect.height, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();
  return {
    bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
    width: aspect.width,
    height: aspect.height,
    skipped: false,
    inputWidth: inW,
    inputHeight: inH,
  };
}
