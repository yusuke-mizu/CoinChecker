import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import type { OpenNextConfig } from "@opennextjs/cloudflare";

const config: OpenNextConfig = {
  ...defineCloudflareConfig(),
  // Default is `npm run build`. That script IS this adapter, so CI would recurse forever.
  buildCommand: "npx next build",
};

export default config;
