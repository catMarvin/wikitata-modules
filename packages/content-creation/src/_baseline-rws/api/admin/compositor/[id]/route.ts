import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { readAll, upsert, remove } from '@/lib/composition-store';
import type { Composition } from '@/lib/composition';

async function gateAdmin() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await gateAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  const all = await readAll();
  const comp = all.find((c) => c.id === id || c.slug === id);
  if (!comp) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(comp);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await gateAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  const body = (await req.json()) as Composition;
  if (body.id !== id) return NextResponse.json({ error: 'id mismatch' }, { status: 400 });
  const saved = await upsert(body);
  return NextResponse.json(saved);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await gateAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  await remove(id);
  return NextResponse.json({ ok: true });
}
