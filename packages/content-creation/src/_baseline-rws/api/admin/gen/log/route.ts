// Local-dev: persist + read the hero-gen operation log to Supabase so it survives
// localStorage clears. POST appends, GET returns recent entries (newest first).
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    msg?: string;
    ok?: boolean;
    sessionId?: string;
    ts?: number;
  };
  if (!body.msg || typeof body.msg !== 'string') {
    return NextResponse.json({ error: 'msg required' }, { status: 400 });
  }

  const { error } = await supabase.from('hero_gen_log').insert({
    msg: body.msg.slice(0, 2000),
    ok: typeof body.ok === 'boolean' ? body.ok : null,
    session_id: body.sessionId ?? null,
    ts: body.ts ? new Date(body.ts).toISOString() : new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') ?? '500')));
  const showArchived = url.searchParams.get('showArchived') === '1';
  let q = supabase
    .from('hero_gen_log')
    .select('id, ts, msg, ok, archived')
    .order('ts', { ascending: false })
    .limit(limit);
  if (!showArchived) q = q.eq('archived', false);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

export async function PATCH(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: 'archive_visible'; before?: number };
  if (body.action !== 'archive_visible') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  const beforeIso = body.before ? new Date(body.before).toISOString() : new Date().toISOString();
  const { error, count } = await supabase
    .from('hero_gen_log')
    .update({ archived: true }, { count: 'exact' })
    .eq('archived', false)
    .lte('ts', beforeIso);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, archivedCount: count ?? 0 });
}
