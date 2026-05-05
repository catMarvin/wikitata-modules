/**
 * cc-demo homepage — proves end-to-end import + introspect of the package.
 */

import { VERSION, STATUS } from '@wikitata/content-creation';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>@wikitata/cc-demo</h1>
      <p style={{ color: '#bcc8d8', marginTop: 0 }}>
        Wikitata-side adoption demo for{' '}
        <code className="mono">@wikitata/content-creation</code>.
      </p>

      <section style={{
        marginTop: 32, padding: 24, borderRadius: 10,
        background: 'var(--bg1)', border: '1px solid var(--bg3)',
      }}>
        <h2 style={{ fontSize: 19, marginTop: 0 }}>Package introspection</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td className="mono" style={{ padding: 8, color: '#9ab' }}>VERSION</td>
              <td className="mono" style={{ padding: 8 }}>{VERSION}</td>
            </tr>
            <tr>
              <td className="mono" style={{ padding: 8, color: '#9ab' }}>STATUS</td>
              <td className="mono" style={{ padding: 8 }}>{STATUS}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 19 }}>Routes wired in this demo</h2>
        <ul>
          <li>
            <code className="mono">GET /content-creation/video-designer/models</code>{' '}
            <span style={{ color: '#9ab' }}>— mounted via{' '}
              <code className="mono">backdropRoutes.models.GET</code>
            </span>
          </li>
          <li>
            <code className="mono">GET /content-creation/compositor/list</code>{' '}
            <span style={{ color: '#9ab' }}>— mounted via{' '}
              <code className="mono">compositorRoutes.list.GET</code>
            </span>
          </li>
        </ul>
        <p style={{ color: '#9ab', fontSize: 13 }}>
          These return <code className="mono">403 forbidden</code> by default — the demo
          uses an always-deny <code className="mono">AuthAdapter</code>. Wire a real auth
          layer (Clerk, Supabase, etc.) to actually exercise them.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 19 }}>What this demo proves</h2>
        <ul>
          <li>The package installs cleanly via pnpm workspace (<code className="mono">workspace:*</code>).</li>
          <li>Headless React components from <code className="mono">/components</code> subpath import.</li>
          <li>Route factories produce framework-neutral <code className="mono">(req: Request) =&gt; Promise&lt;Response&gt;</code> handlers mountable in Next.js App Router.</li>
          <li>The <code className="mono">/content-creation/&#123;video-designer,compositor&#125;</code> URL shape from spec card <code className="mono">bc951384</code> is honored.</li>
        </ul>
      </section>

      <footer style={{ marginTop: 64, color: '#789', fontSize: 12 }}>
        Spec: wikitata card <code className="mono">bc951384</code> · Style: card{' '}
        <code className="mono">68c40443</code> · Repo:{' '}
        <a href="https://github.com/catMarvin/wikitata-modules">catMarvin/wikitata-modules</a>
      </footer>
    </main>
  );
}
