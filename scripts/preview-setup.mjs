// Sets up the preview SQLite db and seeds it.
// Cross-platform (no cross-env dependency).
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  PREVIEW_MODE: "1",
  // The preview schema hardcodes its own SQLite URL, but Prisma still wants
  // DATABASE_URL to be set in some contexts.
  DATABASE_URL: "file:./preview.db",
  NEXTAUTH_SECRET: "preview-secret-not-for-production",
  NEXTAUTH_URL: "http://localhost:3000",
};

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env,
    shell: true,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

run("npx", ["prisma", "db", "push", "--schema=prisma/schema.preview.prisma", "--accept-data-loss"]);
run("npx", ["prisma", "generate", "--schema=prisma/schema.preview.prisma"]);
run("npx", ["tsx", "prisma/seed.ts"]);

console.log("\n✓ preview db ready. Run `npm run preview` next.");
