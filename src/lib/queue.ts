import { Queue } from "bullmq";
import IORedis from "ioredis";

// Preview mode skips Redis entirely. The seed-fed UI doesn't need live polling
// or backfill — match data is already inserted by the seed script. Without this
// guard, API routes that call `backfillQueue.add(...)` would hang trying to
// connect to a Redis that isn't there.
// Also skip Redis when REDIS_URL isn't set (e.g. Vercel build / serverless),
// or during the Next.js build phase, so static page collection doesn't try
// to connect to localhost:6379.
const PREVIEW_MODE =
  process.env.PREVIEW_MODE === "1" ||
  !process.env.REDIS_URL ||
  process.env.NEXT_PHASE === "phase-production-build";

type StubQueue = { add: (..._args: unknown[]) => Promise<void> };

function makeStubQueue(name: string): StubQueue {
  return {
    add: async () => {
      console.log(`[queue:${name}] preview-mode no-op`);
    },
  };
}

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (!_connection) {
    _connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return _connection;
}

export const connection = PREVIEW_MODE
  ? (null as unknown as IORedis)
  : getConnection();

export const monitorQueue: Queue | StubQueue = PREVIEW_MODE
  ? makeStubQueue("reddit-monitor")
  : new Queue("reddit-monitor", { connection: getConnection() });

export const notifyQueue: Queue | StubQueue = PREVIEW_MODE
  ? makeStubQueue("notifications")
  : new Queue("notifications", { connection: getConnection() });

export const digestQueue: Queue | StubQueue = PREVIEW_MODE
  ? makeStubQueue("daily-digest")
  : new Queue("daily-digest", { connection: getConnection() });

export const backfillQueue: Queue | StubQueue = PREVIEW_MODE
  ? makeStubQueue("historical-backfill")
  : new Queue("historical-backfill", { connection: getConnection() });

export async function scheduleMonitorJob() {
  if (PREVIEW_MODE) return;
  await (monitorQueue as Queue).add(
    "scan-all-keywords",
    {},
    {
      repeat: { every: 2 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: 10,
    }
  );
}

// Schedule digest tick — fires every hour on the hour.
// The digest worker itself decides which users to email based on their
// configured digestTime + timezone, so each user gets their digest in their local morning.
export async function scheduleDailyDigest() {
  if (PREVIEW_MODE) return;
  await (digestQueue as Queue).add(
    "digest-tick",
    {},
    {
      repeat: { pattern: "0 * * * *" },
      removeOnComplete: true,
      removeOnFail: 10,
    }
  );
}
