// Local-dev: soft-archive a segment render. File stays on disk; the row in
// public.hero_segment_archive flags it as archived so the state route hides
// it from per-tile history. DELETE removes the row (restore).
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

const ORG = 'readings-with-scot';
const PROJECT = 'rws';
const COMPOSITION = 'home-hero';

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json()) as { slot: string; filename: string; notes?: string };
  if (!body.slot || !body.filename) {
    return NextResponse.json({ error: 'slot + filename required' }, { status: 400 });
  }
  const { error } = await supabase.from('hero_segment_archive').insert({
    organization: ORG,
    project: PROJECT,
    composition: COMPOSITION,
    slot: body.slot,
    filename: body.filename,
    archived_by: user.id,
    notes: body.notes ?? null,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const filename = url.searchParams.get('filename');
  if (!filename) {
    return NextResponse.json({ error: 'filename required' }, { status: 400 });
  }
  const { error } = await supabase.from('hero_segment_archive')
    .delete()
    .eq('organization', ORG)
    .eq('project', PROJECT)
    .eq('composition', COMPOSITION)
    .eq('filename', filename);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { data, error } = await supabase
    .from('hero_segment_archive')
    .select('id, slot, filename, archived_at, notes')
    .eq('organization', ORG)
    .eq('project', PROJECT)
    .eq('composition', COMPOSITION)
    .order('archived_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ archive: data ?? [] });
}
