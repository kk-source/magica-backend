import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Plain env read so `prisma generate` works in builds without DATABASE_URL (e.g. Vercel previews).
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
