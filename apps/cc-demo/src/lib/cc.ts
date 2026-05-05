/**
 * Wikitata-side cc-demo wiring.
 *
 * Demonstrates the canonical adapter assembly for a multi-tenant deployment:
 *   - SupabaseStorageAdapter against a configurable bucket
 *   - VercelAIGatewayAdapter with vault-pulled key (stub here)
 *   - Always-deny auth (replace with real auth before production use)
 *
 * Real wikitata production wiring will inject:
 *   - Real Supabase client (via @supabase/supabase-js)
 *   - Real auth (Sign-in-with-Vercel / Clerk / Supabase Auth)
 *   - Vault-pulled AI Gateway key (wt_vault_inject_to_vercel_env)
 */

import {
  FsAdapter,
  VercelAIGatewayAdapter,
  JsonSpecStore,
  JsonCompositionStore,
  NoopCostLogStore,
  NoopGenLogStore,
  NoopBatchSpendLogStore,
  createBackdropRoutes,
  createCompositorRoutes,
  type AuthAdapter,
  type EnvAdapter,
} from '@wikitata/content-creation';
import path from 'node:path';

const storage = new FsAdapter({
  baseDir: path.join(process.cwd(), '.cc-demo-data'),
  urlPrefix: '/cc-data',
});

const ai = new VercelAIGatewayAdapter({
  apiKey: async () => {
    // Demo uses a placeholder. Real wikitata pulls via vault.
    const k = process.env.AI_GATEWAY_API_KEY ?? 'demo-placeholder-not-real';
    return k;
  },
});

const specStore = new JsonSpecStore({
  storage,
  defaultSpec: () => ({
    anchors: [
      { id: 'demo-a', label: 'Demo anchor A', prompt: 'placeholder', seedFile: null },
      { id: 'demo-b', label: 'Demo anchor B', prompt: 'placeholder', seedFile: null },
    ],
    segments: [],
  }),
});

const compositionStore = new JsonCompositionStore({ storage });

// Always-deny auth — replace before production use.
const auth: AuthAdapter = {
  async requireAdmin() {
    throw new Error('cc-demo: AuthAdapter is always-deny. Wire real auth before exercising routes.');
  },
};

const env: EnvAdapter = {
  isLocalOnlyAllowed: () => true,
  get: (k) => process.env[k],
};

export const backdropRoutes = createBackdropRoutes({
  storage, ai, auth, env,
  specStore,
  costLog: NoopCostLogStore,
  genLog: NoopGenLogStore,
  batchSpendLog: NoopBatchSpendLogStore,
  imageModel: 'bfl/flux-pro-1.1-ultra',
  chatModel: 'anthropic/claude-haiku-4-5',
  aspect: { width: 1920, height: 1080 },
  project: 'cc-demo',
});

export const compositorRoutes = createCompositorRoutes({
  storage, ai, auth, env,
  compositionStore,
  assetPrefix: 'assets',
});
