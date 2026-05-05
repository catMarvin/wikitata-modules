// Upload an asset (image or video) into ./public/brand/ so it has a stable URL
// for compositions to reference. Filename is namespaced and slugified.
import { NextResponse } from 'next/server';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

function safeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset';
  return `${base}${ext}`;
}

const PUBLIC_DIR = () => path.join(process.cwd(), 'public', 'brand');

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const fd = await req.formData();
  const file = fd.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  await mkdir(PUBLIC_DIR(), { recursive: true });
  const filename = safeName(file.name);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(PUBLIC_DIR(), filename), buf);
  return NextResponse.json({ ok: true, url: `/brand/${filename}`, filename, sizeBytes: buf.length });
}

export async function GET() {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  let files: string[] = [];
  try { files = await readdir(PUBLIC_DIR()); } catch {}
  const assets = files
    .filter((f) => /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov)$/i.test(f))
    .map((f) => ({ filename: f, url: `/brand/${f}` }));
  return NextResponse.json({ assets });
}
