#!/usr/bin/env node
/**
 * Prisma db push via session/direct port (Supabase pooler :6543 blocks DDL).
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let url = process.env.DATABASE_URL || process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required");
  process.exit(1);
}

if (!process.env.DIRECT_DATABASE_URL) {
  url = url
    .replace(":6543/", ":5432/")
    .replace(":6543?", ":5432?")
    .replace(/[?&]pgbouncer=true/g, "")
    .replace(/\?&/, "?")
    .replace(/\?$/, "");
}

process.env.DATABASE_URL = url;
console.log("Applying schema (direct/session connection)...");

execSync("npx prisma db push --skip-generate", {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
