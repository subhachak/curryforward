import type { NextConfig } from "next";

// Two deployment shapes, one codebase:
// - `next dev` (NODE_ENV=development): proxy /api/* and /uploads/* to the
//   FastAPI backend so the browser only ever talks to localhost:3000 —
//   same-origin, so the admin session cookie works without extra
//   CORS/cookie-domain config. /uploads/* needs the same treatment as /api/*
//   since that's where hero/step images are served from (backend/app/main.py
//   mounts StaticFiles there) — without it, uploaded images 404 in dev even
//   though they exist and work fine in production.
// - `next build` (NODE_ENV=production): static export. FastAPI mounts the
//   exported files at "/" and serves /api and /uploads itself, so the same
//   relative fetch("/api/...")/<img src="/uploads/...ptr"> calls stay
//   same-origin with zero rewrite needed. Static export doesn't support
//   `rewrites()` at build time, so it's only defined in dev.
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
            { source: "/uploads/:path*", destination: `${backendOrigin}/uploads/:path*` },
            {
              source:
                "/:slug((?!api|uploads|_next|admin|recipes|recipe|login|home-v2|home-classic|apple-icon.png|icon.svg|favicon.ico|robots.txt|sitemap.xml)[^/]+)",
              destination: "/recipe?slug=:slug",
            },
          ];
        },
      }
    : { output: "export" }),
};

export default nextConfig;
