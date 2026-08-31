/** @type {import('next').NextConfig} */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pin the Turbopack root to the web/ package — otherwise the sibling root
// package-lock.json makes Next infer the repo root as workspace root.
const root = path.dirname(fileURLToPath(import.meta.url));

// `next build` emits a fully static export into web/out/, which the toksight
// CLI serves itself (`toksight web`). For `next dev`, set TOKSIGHT_DEV_API to
// the address of a running `toksight web --api-only` and /api/* is proxied
// there, so the dashboard can be developed against live local data.
const devApi =
  process.env.TOKSIGHT_DEV_API ??
  (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:4729' : null);

const nextConfig = devApi
  ? {
      turbopack: { root },
      async rewrites() {
        return [{ source: '/api/:path*', destination: `${devApi}/api/:path*` }];
      },
    }
  : { turbopack: { root }, output: 'export' };

export default nextConfig;
