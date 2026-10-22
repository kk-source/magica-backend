import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_placeholder",
  dirs: ["./trigger"],
  maxDuration: 900,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
