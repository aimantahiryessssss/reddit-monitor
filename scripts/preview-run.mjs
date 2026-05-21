// Starts `next dev` with preview-mode env vars set.
// Re-generates the Prisma client from the SQLite preview schema first, because
// `npm install` (via the postinstall hook) regenerates it from the Postgres
// schema. Without this step, login would fail right after any reinstall.
import { spawn, spawnSync } from "node:child_process";

const env = {
  ...process.env,
  PREVIEW_MODE: "1",
  DATABASE_URL: "file:./preview.db",
  NEXTAUTH_SECRET: "preview-secret-not-for-production",
  NEXTAUTH_URL: "http://localhost:3000",
};

console.log("→ regenerating Prisma client from preview (SQLite) schema");
const gen = spawnSync(
  "npx",
  ["prisma", "generate", "--schema=prisma/schema.preview.prisma"],
  { stdio: "inherit", env, shell: true }
);
if (gen.status !== 0) process.exit(gen.status ?? 1);

console.log("→ starting Next.js dev server on http://localhost:3000\n");
const child = spawn("npx", ["next", "dev"], { stdio: "inherit", env, shell: true });

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
