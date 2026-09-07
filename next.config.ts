import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

void import("@opennextjs/cloudflare")
  .then((mod) => {
    try {
      mod.initOpenNextCloudflareForDev();
    } catch {
      // next dev still works before wrangler login
    }
  })
  .catch(() => {
    // next dev still works if OpenNext is not installed
  });

