import { fileURLToPath } from 'node:url';
// Next reads `.env` from the app directory, but ours lives at the repository
// root so the apps and the database scripts cannot disagree about which
// database they are pointed at. Loaded here because next.config runs before
// anything else in the server process. Same as apps/site.
import { loadEnv } from '../../scripts/load-env.mjs';
loadEnv();

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * A self-contained server, for the container image.
   *
   * `standalone` traces exactly the files the server needs and emits its own
   * `server.js`, so the runtime image carries neither pnpm nor the workspace's
   * node_modules — about a gigabyte per service that would otherwise be copied
   * three times and rebuilt on every deploy.
   *
   * `outputFileTracingRoot` has to be the REPOSITORY root, not the app
   * directory: pnpm puts the real packages in a root `node_modules/.pnpm`
   * store and symlinks into it, so tracing from the app directory follows the
   * links out of its own root and silently drops them from the output. The
   * symptom is a container that builds cleanly and then cannot find `postgres`
   * at runtime.
   */
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  // The domain package is plain TypeScript compiled by Next itself rather than
  // a pre-built artefact — one less build step between a change and seeing it.
  experimental: { externalDir: true },
  // The CRM talks to Postgres from server components and server actions, so it
  // must run in the Node runtime — the Edge runtime has no TCP sockets. Same
  // constraint that moved tenant resolution out of middleware on the public
  // site; see apps/site/src/request.ts.
  serverExternalPackages: ['postgres'],
  // @forecourt/domain ships TypeScript source rather than a build step, so Next
  // has to compile it. That is deliberate: the domain layer is consumed only by
  // apps in this repo, and a build artefact between them is a place for the two
  // to drift.
  transpilePackages: ['@forecourt/domain'],

  /**
   * `@forecourt/domain` imports its own modules with `.js` specifiers —
   * `export * from './money.js'` — which is correct ESM: the specifier names
   * the file that will exist at runtime, not the TypeScript source. Node and
   * vitest both resolve it. Webpack does not, without being told.
   *
   * The alternative was stripping the extensions in the domain package, which
   * would break it for every consumer that runs it as real ESM. Aliasing here
   * keeps the package correct and confines the workaround to the bundler that
   * needs it.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};
