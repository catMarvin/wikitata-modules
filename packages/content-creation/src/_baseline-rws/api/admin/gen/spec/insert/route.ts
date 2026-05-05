// Insert a new intermediate anchor at a position in the spec.
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import {
  loadSpec,
  saveSpec,
  rebuildSegments,
  defaultBridgeAnchorPrompt,
  type SpecAnchor,
} from '@/lib/spec-store';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `bridge-${Date.now()}`;
}

export async function POST(req: Request) {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as {
    afterIndex: number; // 0-based; new anchor inserted at afterIndex+1
    label?: string;
    prompt?: string;
    id?: string;
  };

  const spec = await loadSpec();
  const idx = body.afterIndex;
  if (idx < 0 || idx >= spec.anchors.length) {
    return NextResponse.json({ error: 'afterIndex out of range' }, { status: 400 });
  }
  const before = spec.anchors[idx];
  const after = spec.anchors[(idx + 1) % spec.anchors.length];

  const label = body.label?.trim() || `${before.id} → ${after.id} bridge`;
  let id = body.id?.trim() || slugify(label);
  // Avoid id collision
  const existing = new Set(spec.anchors.map((a) => a.id));
  if (existing.has(id)) {
    let n = 2;
    while (existing.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  const prompt = body.prompt?.trim() || defaultBridgeAnchorPrompt(before, after);

  const newAnchor: SpecAnchor = { id, label, prompt };
  const next = {
    ...spec,
    anchors: [...spec.anchors.slice(0, idx + 1), newAnchor, ...spec.anchors.slice(idx + 1)],
  };
  const rebuilt = rebuildSegments(next);
  await saveSpec(rebuilt);
  return NextResponse.json({ ok: true, spec: rebuilt, insertedId: id });
}
