import type { NextConfig } from "next";

const supabaseInternalUrl = process.env.SUPABASE_INTERNAL_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    if (!supabaseInternalUrl) {
      return [];
    }

    return [
      {
        source: "/supabase/:path*",
        destination: `${supabaseInternalUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
