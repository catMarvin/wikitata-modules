// Returns the live AI Gateway balance + cumulative spend.
// Used by /admin/generate-bg to compute exact batch-render cost (delta of total_used).
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { getGatewayUsage } from '@/lib/ai-gateway';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const usage = await getGatewayUsage();
    return NextResponse.json(usage);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
