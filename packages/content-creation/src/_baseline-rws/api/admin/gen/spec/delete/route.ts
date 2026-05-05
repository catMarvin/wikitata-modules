// Delete an anchor from the spec by id (refuses to leave fewer than 2).
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { loadSpec, saveSpec, rebuildSegments } from '@/lib/spec-store';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { id } = (await req.json()) as { id: string };
  const spec = await loadSpec();
  if (spec.anchors.length <= 2) {
    return NextResponse.json({ error: 'need at least 2 anchors' }, { status: 400 });
  }
  const next = { ...spec, anchors: spec.anchors.filter((a) => a.id !== id) };
  const rebuilt = rebuildSegments(next);
  await saveSpec(rebuilt);
  return NextResponse.json({ ok: true, spec: rebuilt });
}
