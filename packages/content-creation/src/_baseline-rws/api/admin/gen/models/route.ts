// Returns the list of AI Gateway video models surfaced in the picker.
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { VIDEO_MODELS } from '@/lib/bg-spec';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({ models: VIDEO_MODELS });
}
