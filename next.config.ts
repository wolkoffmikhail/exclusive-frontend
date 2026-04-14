import type { NextConfig } from "next";

const supabaseInternal = process.env.SUPABASE_INTERNAL_URL?.replace(/\/$/, "");
const buildDir = process.env.NEXT_DIST_DIR || ".next-exclusive";

const nextConfig: NextConfig = {
  distDir: buildDir,
  async rewrites() {
    if (!supabaseInternal) {
      return [];
    }

    return [
      {
        source: "/supabase/:path*",
        destination: `${supabaseInternal}/:path*`,
      },
    ];
  },
};

export default nextConfig;
