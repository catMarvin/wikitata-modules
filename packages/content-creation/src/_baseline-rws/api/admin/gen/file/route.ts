// Local-dev: serves files from generated/ for the admin preview UI.
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

export async function GET(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind');
  const name = url.searchParams.get('name');
  if ((kind !== 'anchor' && kind !== 'segment' && kind !== 'loop' && kind !== 'lab') || !name) {
    return NextResponse.json({ error: 'kind+name required' }, { status: 400 });
  }
  const safeName = path.basename(name);
  const subdir = kind === 'anchor' ? 'anchors' : kind === 'segment' ? 'segments' : kind === 'lab' ? 'lab' : null;
  const abs = subdir
    ? path.join(process.cwd(), 'generated', subdir, safeName)
    : path.join(process.cwd(), 'generated', safeName);

  let buf: Buffer;
  try { buf = await readFile(abs); } catch { return NextResponse.json({ error: 'not found' }, { status: 404 }); }

  const ext = path.extname(safeName).toLowerCase();
  const ct = ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.mp4' ? 'video/mp4'
    : 'application/octet-stream';

  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': ct, 'Cache-Control': 'no-store' },
  });
}
