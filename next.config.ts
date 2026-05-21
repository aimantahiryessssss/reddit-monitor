import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Lint runs locally; skipping during `next build` keeps Vercel deploys
    // from breaking on flat-config / eslint-config-next interop issues.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
