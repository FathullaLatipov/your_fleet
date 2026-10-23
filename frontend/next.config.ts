import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is fully dynamic (all data comes from the API at request time),
  // so component prerender caching is disabled.
  cacheComponents: false,
  // Same-origin /api and /media are proxied to the backend. This lets the
  // HTTPS frontend (Vercel) talk to an HTTP backend without mixed content,
  // and removes the need for CORS. Override with API_PROXY_TARGET at build.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET ?? "http://187.124.130.233:8010";
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      { source: "/media/:path*", destination: `${target}/media/:path*` },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
