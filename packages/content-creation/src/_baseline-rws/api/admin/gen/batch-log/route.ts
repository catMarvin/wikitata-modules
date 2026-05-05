// Persists batch-render spend rows so the Batch Spend pane survives reloads.
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';

export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    segIndices?: number[];
    segLabels?: string[];
    okCount?: number;
    errCount?: number;
    costMeasured?: number | null;
    costEstimate?: number;
    balanceBefore?: number | null;
    balanceAfter?: number | null;
    model?: string;
    ts?: number;
  };
  if (!Array.isArray(body.segIndices) || !Array.isArray(body.segLabels)) {
    return NextResponse.json({ error: 'segIndices + segLabels required' }, { status: 400 });
  }
  const { error } = await supabase.from('hero_batch_spend_log').insert({
    ts: body.ts ? new Date(body.ts).toISOString() : new Date().toISOString(),
    seg_indices: body.segIndices,
    seg_labels: body.segLabels,
    ok_count: body.okCount ?? 0,
    err_count: body.errCount ?? 0,
    cost_measured: body.costMeasured ?? null,
    cost_estimate: body.costEstimate ?? 0,
    balance_before: body.balanceBefore ?? null,
    balance_after: body.balanceAfter ?? null,
    model: body.model ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { data, error } = await supabase
    .from('hero_batch_spend_log')
    .select('id, ts, seg_indices, seg_labels, ok_count, err_count, cost_measured, cost_estimate, balance_before, balance_after, model')
    .order('ts', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
