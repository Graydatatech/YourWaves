/**
 * Loads environment files the way Next.js does, so a plain `node scripts/*.mjs`
 * sees the same DATABASE_URL as `next dev` does.
 *
 * Precedence (first match wins, matching Next): .env.local then .env.
 * Import this for its side effect before reading process.env.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
