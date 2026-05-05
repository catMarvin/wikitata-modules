// Phase 3 — rasterize a Composition into a standalone mp4 by stepping through
// frames with headless Chromium and feeding them to ffmpeg.
// Strategy:
//   1. Boot a Playwright Chromium instance and load /admin/compositor/render?id=X&t=<ms>
//      (a server-rendered, JS-free preview route that paints the comp at exactly t).
//   2. For t in [0, durationMs] step (1000/fps), screenshot the canvas div.
//   3. Pipe the PNG sequence through ffmpeg → mp4.
//
// This is the heavyweight option. It requires playwright + ffmpeg on the host.
// Until playwright is installed, this route returns a 501 with install instructions.
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { getBySlug } from '@/lib/composition-store';
import { aspectRatioToNumber } from '@/lib/composition';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json()) as { slug?: string; fps?: number; widthPx?: number };
  const slug = body.slug ?? 'home-hero';
  const fps = body.fps ?? 30;
  const comp = await getBySlug(slug);
  if (!comp) return NextResponse.json({ error: 'composition not found' }, { status: 404 });

  // Try to require playwright dynamically; if absent, surface install instructions.
  // Dynamic import without static type dep on `playwright` (so the project
  // type-checks without the package installed). The bake endpoint surfaces an
  // install hint when the require fails at runtime.
  type ChromiumLauncher = { launch: () => Promise<{
    newContext: (o: { viewport: { width: number; height: number } }) => Promise<{
      newPage: () => Promise<{
        goto: (url: string, opts?: { waitUntil?: 'networkidle' }) => Promise<unknown>;
        screenshot: (opts?: { type?: 'png'; fullPage?: boolean }) => Promise<Buffer>;
      }>;
    }>;
    close: () => Promise<void>;
  }> };
  let chromium: ChromiumLauncher | null = null;
  try {
    const pw = await (Function('m', 'return import(m)') as (m: string) => Promise<{ chromium: ChromiumLauncher }>)('playwright');
    chromium = pw.chromium;
  } catch {
    return NextResponse.json({
      error: 'playwright not installed',
      install: 'npm i -D playwright && npx playwright install chromium',
    }, { status: 501 });
  }

  const widthPx = body.widthPx ?? 1920;
  const heightPx = Math.round(widthPx / aspectRatioToNumber(comp.canvas.aspectRatio));
  const totalFrames = Math.ceil((comp.durationMs / 1000) * fps);

  const path = await import('node:path');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { spawn } = await import('node:child_process');
  const cwd = process.cwd();
  const framesDir = path.join(cwd, 'generated', 'bake', `${slug}-${Date.now()}`);
  await mkdir(framesDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: widthPx, height: heightPx } });
  const page = await context.newPage();

  const origin = req.url.split('/api/')[0];
  for (let i = 0; i < totalFrames; i++) {
    const t = Math.round((i / fps) * 1000);
    await page.goto(`${origin}/admin/compositor/render?id=${encodeURIComponent(comp.id)}&t=${t}`, { waitUntil: 'networkidle' });
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    await writeFile(path.join(framesDir, `f${String(i).padStart(6, '0')}.png`), buf);
  }
  await browser.close();

  const outFile = path.join(cwd, 'generated', `${slug}-${Date.now()}.mp4`);
  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(framesDir, 'f%06d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-an',
    outFile,
  ];
  const code = await new Promise<number>((resolve) => {
    const ff = spawn('ffmpeg', args, { stdio: 'inherit' });
    ff.on('close', (c) => resolve(c ?? 1));
  });
  if (code !== 0) return NextResponse.json({ error: 'ffmpeg failed' }, { status: 500 });

  return NextResponse.json({ ok: true, filename: path.basename(outFile), framesDir });
}
