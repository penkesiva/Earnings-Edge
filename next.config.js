/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', '*.vercel.app'],
    },
  },

  /**
   * Tell browsers and Vercel Edge never to cache HTML pages.
   * Without this, browsers use heuristic caching and serve stale HTML after
   * a rescan — the user sees old badges/decisions until they hard-refresh.
   *
   * Static Next.js assets (_next/static) have their own immutable cache
   * headers set by Next.js and are excluded here.
   */
  async headers() {
    return [
      {
        // All app routes (pages). Excludes _next/* and public/* static assets.
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
