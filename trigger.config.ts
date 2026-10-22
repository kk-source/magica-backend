import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? process.env.TRIGGER_PROJECT_ID ?? "proj_ijmadegvkpiphpaqqhng",
  dirs: ["./trigger"],
  maxDuration: 900,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
  // Skills are read from disk at runtime, so they must ship with the deployed worker.
  build: { extensions: [additionalFiles({ files: ["./agent-skills/**"] })] },
});
