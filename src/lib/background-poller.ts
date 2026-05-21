/**
 * In-process Reddit poller. Replaces the BullMQ worker for the no-Redis
 * dev setup. Sweeps every user's active keywords on an interval; for each
 * newly-stored match, refreshKeyword fires off an email alert (if the user
 * opted in and RESEND_API_KEY is set).
 *
 * Started by src/instrumentation.ts on Next.js server boot. Uses a global
 * sentinel so HMR / multi-import doesn't spawn duplicate timers.
 */
import { prisma } from "./prisma";
import { refreshAllActiveKeywords } from "./live-fetch";

// Bumped 5min → 15min. Each sweep does a full refreshAllActiveKeywords
// across every user (Reddit + pullpush submissions + pullpush comments per
// keyword = ~5 HTTP roundtrips per keyword) and was thrashing the event loop
// while teammates were trying to load the dashboard. 15min is plenty for
// "ambient" alerts; users can still hit the Refresh button for on-demand.
const INTERVAL_MS = 15 * 60_000;
const GLOBAL_KEY = "__redditMonitorPoller";

declare global {
  // eslint-disable-next-line no-var
  var __redditMonitorPoller: { started: boolean; timer: NodeJS.Timeout | null } | undefined;
}

async function sweepOnce() {
  const start = Date.now();
  try {
    const users = await prisma.user.findMany({
      where: { keywords: { some: { active: true } } },
      select: { id: true, email: true },
    });
    if (users.length === 0) return;

    let totalNew = 0;
    for (const u of users) {
      try {
        const results = await refreshAllActiveKeywords(u.id, { t: "day", limit: 25 });
        totalNew += results.reduce((s, r) => s + r.newMatches, 0);
      } catch (err) {
        console.error(`[poller] user ${u.id} sweep failed:`, err);
      }
    }
    const ms = Date.now() - start;
    console.log(`[poller] swept ${users.length} user(s), ${totalNew} new match(es) in ${ms}ms`);
  } catch (err) {
    console.error("[poller] sweep error:", err);
  }
}

export function startBackgroundPoller() {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: { started: boolean; timer: NodeJS.Timeout | null } };
  if (g[GLOBAL_KEY]?.started) {
    return; // already running (HMR re-import, or instrumentation fired twice)
  }
  g[GLOBAL_KEY] = { started: true, timer: null };

  console.log(`[poller] starting — every ${INTERVAL_MS / 60_000} min`);
  // Delay the first sweep by 90s instead of 10s — that gives teammates
  // hitting the freshly-booted dashboard time to load their first view
  // before the poller starts thrashing Reddit/pullpush/DB.
  setTimeout(() => {
    sweepOnce();
    const timer = setInterval(sweepOnce, INTERVAL_MS);
    g[GLOBAL_KEY]!.timer = timer;
  }, 90_000);
}
