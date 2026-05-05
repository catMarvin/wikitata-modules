/**
 * cc-demo root layout.
 *
 * Token canon: Steel blue (wikitata card 68c40443) applied at :root via
 * inline CSS vars. Consumer apps using @wikitata/content-creation should
 * provide the same token surface so headless components render correctly.
 */

import type { ReactNode } from 'react';

export const metadata = {
  title: '@wikitata/content-creation demo',
  description: 'Wikitata-side adoption demo — Video Designer + Compositor.',
};

const STEEL_TOKEN_CSS = `
:root{
  --bg0:#0a0c10; --bg1:#11141a; --bg2:#181c25; --bg3:#222836;
  --gold:#4a7cb8; --gold-hi:#5b8dc8; --gold-lo:#3a6ca8; --btn-text:#f4f8fc;
  --acc:#22cc55; --warn:#ff5a8c;
  --sans:'Inter',-apple-system,system-ui,sans-serif;
  --mono:'Share Tech Mono',ui-monospace,monospace;
  color-scheme: dark;
}
html, body { background: var(--bg0); color: #f4f8fc; font-family: var(--sans); margin: 0; padding: 0; }
a { color: var(--gold); }
a:hover { color: var(--gold-hi); }
code, .mono { font-family: var(--mono); }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: STEEL_TOKEN_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
