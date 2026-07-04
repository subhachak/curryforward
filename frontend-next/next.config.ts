import type { NextConfig } from "next";

// Two deployment shapes, one codebase:
// - `next dev` (NODE_ENV=development): proxy /api/* to the FastAPI backend
//   so the browser only ever talks to localhost:3000 — same-origin, so the
//   admin session cookie works without extra CORS/cookie-domain config.
// - `next build` (NODE_ENV=production): static export. FastAPI mounts the
//   exported files at "/" and serves /api itself, so the same relative
//   fetch("/api/...") calls stay same-origin with zero rewrite needed.
//   Static export doesn't support `rewrites()` at build time, so it's only
//   defined in dev.
const isDev = process.env.NODE_ENV !== "production";
const backendOrigin = process.env.BACKEND_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // FastAPI's StaticFiles(html=True) only auto-serves "index.html" for
  // directory paths, not "<route>.html" siblings — so routes need a
  // trailing slash to export as e.g. recipe/index.html instead of
  // recipe.html for /recipe to resolve.
  trailingSlash: true,
  ...(isDev
    ? {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: `${backendOrigin}/api/:path*` },
          ];
        },
      }
    : { output: "export" }),
};

export default nextConfig;
