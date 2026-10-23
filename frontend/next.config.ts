import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is fully dynamic (all data comes from the API at request time),
  // so component prerender caching is disabled.
  cacheComponents: false,
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
