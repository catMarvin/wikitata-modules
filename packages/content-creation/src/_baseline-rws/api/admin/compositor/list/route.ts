import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { readAll } from '@/lib/composition-store';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const all = await readAll();
  return NextResponse.json({ compositions: all.map((c) => ({ id: c.id, slug: c.slug, name: c.name, updatedAt: c.updatedAt })) });
}
