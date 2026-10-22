import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? process.env.TRIGGER_PROJECT_ID ?? "proj_ijmadegvkpiphpaqqhng",
  dirs: ["./trigger"],
  maxDuration: 900,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
