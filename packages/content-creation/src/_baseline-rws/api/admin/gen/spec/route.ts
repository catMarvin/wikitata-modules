// Read or replace the runtime hero-bg spec (./generated/spec.json).
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { loadSpec, saveSpec, rebuildSegments, type Spec } from '@/lib/spec-store';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

async function gateAdmin() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return false;
  return true;
}

export async function GET() {
  assertLocal();
  if (!(await gateAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const spec = await loadSpec();
  return NextResponse.json(spec);
}

export async function POST(req: Request) {
  assertLocal();
  if (!(await gateAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json()) as Spec;
  if (!Array.isArray(body.anchors) || body.anchors.length < 2) {
    return NextResponse.json({ error: 'spec must have at least 2 anchors' }, { status: 400 });
  }
  const rebuilt = rebuildSegments(body);
  await saveSpec(rebuilt);
  return NextResponse.json(rebuilt);
}
