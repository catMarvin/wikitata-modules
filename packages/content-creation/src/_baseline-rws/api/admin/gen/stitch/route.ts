// Local-dev: stitches 6 segments via ffmpeg with 0.5s crossfade joins.
import { NextResponse } from 'next/server';
import { readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { loadSpec } from '@/lib/spec-store';

function assertLocal() { if (process.env.VERCEL) throw new Error('local-only'); }

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (b) => { stderr += b.toString(); });
    ff.on('close', (code) => resolve({ code: code ?? 1, stderr }));
    ff.on('error', reject);
  });
}

export async function POST() {
  assertLocal();
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const cwd = process.cwd();
  const segDir = path.join(cwd, 'generated', 'segments');
  let files: string[];
  try { files = await readdir(segDir); } catch { return NextResponse.json({ error: 'no segments dir' }, { status: 400 }); }

  const spec = await loadSpec();
  function segMatcher(prefix: string): RegExp {
    const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^seg-${esc}-\\d+\\.mp4$`);
  }
  const latestPerSegment: string[] = [];
  for (let i = 0; i < spec.segments.length; i++) {
    const seg = spec.segments[i];
    const slotKey = `${seg.startAnchor}__${seg.endAnchor}`;
    const slotRe = segMatcher(slotKey);
    const legacyRe = segMatcher(String(i + 1));
    const slotMatches = files.filter((f) => slotRe.test(f)).sort();
    const legacyMatches = files.filter((f) => legacyRe.test(f)).sort();
    const matches = [...legacyMatches, ...slotMatches];
    if (!matches.length) {
      return NextResponse.json(
        { error: `missing segment ${i + 1} (${seg.startAnchor} → ${seg.endAnchor})` },
        { status: 400 }
      );
    }
    latestPerSegment.push(path.join(segDir, matches[matches.length - 1]));
  }

  const outDir = path.join(cwd, 'generated');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `loop-${Date.now()}.mp4`);

  // Build xfade chain: 6 inputs, fade-out last 0.5s of N into first 0.5s of N+1
  const xfade = 0.5;
  const inputs: string[] = [];
  latestPerSegment.forEach((f) => {
    inputs.push('-i', f);
  });

  // Need each segment's exact duration to compute xfade offsets.
  const durations: number[] = [];
  for (const f of latestPerSegment) {
    const probe = await runFfmpeg(['-i', f]);
    const m = probe.stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (!m) return NextResponse.json({ error: `cannot probe ${f}` }, { status: 500 });
    const [, hh, mm, ss] = m;
    durations.push(Number(hh) * 3600 + Number(mm) * 60 + Number(ss));
  }

  // Filter: chain v0+v1 → v01, then v01+v2 → v012, etc.
  // offset for join N (0-based) = sum of durations[0..N] - xfade*(N+1)
  const filterParts: string[] = [];
  let prevLabel = '[0:v]';
  let acc = durations[0];
  for (let i = 1; i < latestPerSegment.length; i++) {
    const offset = (acc - xfade).toFixed(3);
    const out = i === latestPerSegment.length - 1 ? '[vout]' : `[v${i}]`;
    filterParts.push(`${prevLabel}[${i}:v]xfade=transition=fade:duration=${xfade}:offset=${offset}${out}`);
    prevLabel = `[v${i}]`;
    acc += durations[i] - xfade;
  }
  const filter = filterParts.join(';');

  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[vout]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-crf', '20',
    '-an',
    outFile,
  ];
  const r = await runFfmpeg(args);
  if (r.code !== 0) {
    return NextResponse.json({ error: 'ffmpeg failed', stderr: r.stderr.slice(-2000) }, { status: 500 });
  }

  // Mobile derivative: 9:16 center-crop, scaled to 1080x1920.
  const mobileFile = path.join(outDir, `loop-${path.basename(outFile, '.mp4').replace(/^loop-/, '')}-mobile.mp4`);
  const mobileArgs = [
    '-y',
    '-i', outFile,
    '-vf', 'crop=ih*9/16:ih,scale=1080:1920',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-crf', '22',
    '-an',
    mobileFile,
  ];
  const m = await runFfmpeg(mobileArgs);
  if (m.code !== 0) {
    return NextResponse.json({ error: 'mobile ffmpeg failed', stderr: m.stderr.slice(-2000) }, { status: 500 });
  }

  // Poster: extract first frame as jpg for the desktop video.
  const posterFile = path.join(outDir, `${path.basename(outFile, '.mp4')}.jpg`);
  const posterArgs = [
    '-y',
    '-i', outFile,
    '-frames:v', '1',
    '-q:v', '2',
    posterFile,
  ];
  await runFfmpeg(posterArgs);

  const s = await stat(outFile);
  const sm = await stat(mobileFile);
  return NextResponse.json({
    ok: true,
    filename: path.basename(outFile),
    mobileFilename: path.basename(mobileFile),
    posterFilename: path.basename(posterFile),
    durationS: Math.round(acc * 10) / 10,
    sizeMb: Math.round((s.size / 1024 / 1024) * 10) / 10,
    mobileSizeMb: Math.round((sm.size / 1024 / 1024) * 10) / 10,
  });
}
