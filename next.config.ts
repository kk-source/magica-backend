import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // agent-skills/ is read from disk at runtime; make sure it ships with the server bundle.
  outputFileTracingIncludes: { "/api/**/*": ["./agent-skills/**/*"] },
};

export default nextConfig;
