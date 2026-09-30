import type { NextConfig } from "next";

/** همهٔ مسیرهایی که Next آن‌ها را نمی‌شناسد به سرور بازی (appg/server.cjs روی 127.0.0.1:3001) پروکسی می‌شوند. */
const GAME = process.env.GAME_UPSTREAM || "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [{ source: "/:path*", destination: `${GAME}/:path*` }],
    };
  },
};

export default nextConfig;
