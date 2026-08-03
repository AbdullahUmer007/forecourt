/**
 * The public site is route handlers only — no pages, no components, no client
 * bundle. `next dev` still wants React present as a peer, but nothing imports
 * it, and the JS a buyer downloads is zero bytes.
 */
// Next reads `.env` from the app directory, but ours lives at the repository
// root so the site and the database scripts cannot disagree about which
// database they are pointed at. Loaded here because next.config runs before
// anything else in the server process.
import { loadEnv } from '../../scripts/load-env.mjs';
loadEnv();

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  // The render layer and the domain package are plain TypeScript compiled by
  // Next itself, rather than pre-built packages. One less build step between a
  // change and seeing it.
  experimental: { externalDir: true },
  /**
   * The codebase imports TypeScript with a `.js` specifier — `./src/tenant.js`
   * resolving to `tenant.ts` — which is what `moduleResolution: "Bundler"` and
   * native ESM both expect. Webpack does not do that by default, so it is
   * spelled out here rather than by rewriting several hundred imports to a
   * convention that would then be wrong for Node.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'x-content-type-options', value: 'nosniff' },
        { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};
