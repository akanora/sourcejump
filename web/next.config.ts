import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for the VPS (ADR 0005).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // 75 is the default for every image. The home banner asks for 90: at 75 its film grain is smoothed away and
    // the fog looks flat; 90 keeps it for about 80 KB at full size.
    qualities: [75, 90],
  },
  // In production Caddy sends /v1/* to the API before the web app sees it. In development this does the
  // same, so the browser reaches both on one origin, as sign-in cookies require.
  async rewrites() {
    const api = process.env.SJ_API_URL ?? "http://127.0.0.1:8080";
    return [{ source: "/v1/:path*", destination: `${api}/v1/:path*` }];
  },
  experimental: {
    // That proxying buffers request bodies, cut off at 10 MB by default; a packed map can be up to the API's
    // 256 MB (`staff/map_viewer_file.rs`). Production doesn't pass through here.
    proxyClientMaxBodySize: "256mb",
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
