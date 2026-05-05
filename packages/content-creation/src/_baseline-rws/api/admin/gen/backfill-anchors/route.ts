// One-shot: push every local anchor file in /generated/anchors/ into the
// hero-anchors Supabase Storage bucket. Idempotent — files already present
// (same name + size) are skipped. Used to unblock URL-mode video models
// (Seedance/Wan/Grok) for anchors generated before the upload wiring landed.
import { NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { uploadAnchorImage } from '@/lib/storage';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

export const maxDuration = 300;

export async function POST() {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const cwd = process.cwd();
  const anchorsDir = path.join(cwd, 'generated', 'anchors');
  let files: string[] = [];
  try { files = await readdir(anchorsDir); } catch {
    return NextResponse.json({ error: 'no anchors directory' }, { status: 404 });
  }
  const images = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));

  // Pull existing object list once so we can skip already-uploaded names.
  const existing = new Set<string>();
  try {
    const { data: list } = await supabase.storage.from('hero-anchors').list('', { limit: 1000 });
    for (const o of list ?? []) existing.add(o.name);
  } catch {}

  const results: { uploaded: string[]; skipped: string[]; failed: { name: string; error: string }[] } = {
    uploaded: [], skipped: [], failed: [],
  };

  for (const name of images) {
    if (existing.has(name)) { results.skipped.push(name); continue; }
    try {
      const abs = path.join(anchorsDir, name);
      const st = await stat(abs);
      if (!st.isFile()) continue;
      const buf = await readFile(abs);
      await uploadAnchorImage(supabase, name, buf);
      results.uploaded.push(name);
    } catch (e) {
      results.failed.push({ name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    totals: {
      scanned: images.length,
      uploaded: results.uploaded.length,
      skipped: results.skipped.length,
      failed: results.failed.length,
    },
    ...results,
  });
}
