import "./scripts/load-env.mjs";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Hand-written migrations (locking SQL, RLS) live alongside the generated
  // ones and are applied in filename order by the same runner.
  strict: true,
  verbose: true,
});
