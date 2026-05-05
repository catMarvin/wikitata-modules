import type { NextConfig } from 'next';

const config: NextConfig = {
  // Transpile the workspace package so its TS source is bundled fresh on
  // each build of the consumer rather than pinning to a published dist.
  transpilePackages: ['@wikitata/content-creation'],
  experimental: {
    // Future-proof for cache components; v0.0.1 doesn't use them yet.
  },
};

export default config;
