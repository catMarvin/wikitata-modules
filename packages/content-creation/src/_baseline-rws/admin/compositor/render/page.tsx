// Frame-render route used by the bake endpoint. Renders a composition at an
// exact time (?t=ms) inside a fullbleed canvas with no chrome, so playwright
// can screenshot it cleanly.
import { getBySlug, readAll } from '@/lib/composition-store';
import Composition from '@/app/_components/Composition';

export const dynamic = 'force-dynamic';

export default async function CompositionRenderPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; slug?: string; t?: string }>;
}) {
  const params = await searchParams;
  let comp = null;
  if (params.id) {
    const all = await readAll();
    comp = all.find((c) => c.id === params.id) ?? null;
  } else if (params.slug) {
    comp = await getBySlug(params.slug);
  } else {
    comp = await getBySlug('home-hero');
  }
  if (!comp) return <div>not found</div>;
  const t = params.t ? Number(params.t) : 0;
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: 'black' }}>
        <div style={{ width: '100vw', height: '100vh' }}>
          <Composition comp={comp} timeMs={t} sizeMode="fill" />
        </div>
      </body>
    </html>
  );
}
