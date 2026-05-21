import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { searchRedditPosts, searchRedditComments, pullpushBackfill } from "../lib/reddit";
import { sendMatchAlert } from "../lib/email";
import { connection, notifyQueue, scheduleMonitorJob, scheduleDailyDigest } from "../lib/queue";

// Main monitor worker — scans all active keywords
export const monitorWorker = new Worker(
  "reddit-monitor",
  async (job) => {
    console.log("[Monitor] Starting Reddit scan for all keywords...");

    const keywords = await prisma.keyword.findMany({
      where: { active: true },
      include: { user: true },
    });

    console.log(`[Monitor] Found ${keywords.length} active keywords`);

    for (const kw of keywords) {
      try {
        const [posts, comments] = await Promise.all([
          searchRedditPosts(kw.keyword, { limit: 25, historical: false }),
          searchRedditComments(kw.keyword, { limit: 25, historical: false }),
        ]);

        const allResults = [...posts, ...comments];

        for (const result of allResults) {
          // Upsert the Reddit post/comment
          const redditPost = await prisma.redditPost.upsert({
            where: { redditId: result.id },
            create: {
              redditId: result.id,
              type: result.type,
              title: result.title,
              content: result.content,
              subreddit: result.subreddit,
              author: result.author,
              url: result.url,
              score: result.score,
              numComments: result.numComments,
              createdUtc: result.createdUtc,
              isHistorical: false,
            },
            update: { score: result.score, numComments: result.numComments },
          });

          // Create match if it doesn't exist
          const existing = await prisma.match.findUnique({
            where: {
              userId_keywordId_redditPostId: {
                userId: kw.userId,
                keywordId: kw.id,
                redditPostId: redditPost.id,
              },
            },
          });

          if (!existing) {
            const match = await prisma.match.create({
              data: {
                userId: kw.userId,
                keywordId: kw.id,
                redditPostId: redditPost.id,
              },
            });

            // Update daily stats
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            await prisma.dailyStats.upsert({
              where: { userId_keywordId_date: { userId: kw.userId, keywordId: kw.id, date: today } },
              create: { userId: kw.userId, keywordId: kw.id, date: today, count: 1 },
              update: { count: { increment: 1 } },
            });

            // Queue notification
            if (kw.user.instantAlerts && kw.user.emailAlerts) {
              await notifyQueue.add("send-alert", {
                matchId: match.id,
                userEmail: kw.user.email,
                userName: kw.user.name,
                keyword: kw.keyword,
                postTitle: result.title,
                postContent: result.content,
                subreddit: result.subreddit,
                author: result.author,
                url: result.url,
                type: result.type,
                createdUtc: result.createdUtc,
              });
            }
          }
        }

        // Update lastCheckedAt
        await prisma.keyword.update({
          where: { id: kw.id },
          data: { lastCheckedAt: new Date() },
        });

        console.log(`[Monitor] Keyword "${kw.keyword}": ${allResults.length} results checked`);
      } catch (err) {
        console.error(`[Monitor] Error processing keyword "${kw.keyword}":`, err);
      }
    }

    console.log("[Monitor] Scan complete");
  },
  { connection, concurrency: 1 }
);

// Notification worker — sends email alerts
export const notifyWorker = new Worker(
  "notifications",
  async (job) => {
    const { matchId, ...emailData } = job.data;
    try {
      await sendMatchAlert(emailData);
      await prisma.match.update({
        where: { id: matchId },
        data: { notified: true },
      });
      console.log(`[Notify] Alert sent for match ${matchId}`);
    } catch (err) {
      console.error(`[Notify] Failed to send alert for match ${matchId}:`, err);
    }
  },
  { connection, concurrency: 5 }
);

// Historical backfill worker — fetches past Reddit data for a keyword
export const backfillWorker = new Worker(
  "historical-backfill",
  async (job) => {
    const { keywordId, userId, keyword } = job.data;
    console.log(`[Backfill] Starting historical fetch for "${keyword}"`);

    try {
      // 1) Reddit official API: recent + ~1000-result-deep search
      const [posts, comments] = await Promise.all([
        searchRedditPosts(keyword, { limit: 100, historical: true }),
        searchRedditComments(keyword, { limit: 100, historical: true }),
      ]);

      // 2) pullpush.io: deep history beyond what Reddit search returns.
      //    If it fails (mirror down / rate-limited), we still have the API results above.
      let pullpushResults: Awaited<ReturnType<typeof pullpushBackfill>> = [];
      try {
        pullpushResults = await pullpushBackfill(keyword, { maxItems: 500 });
      } catch (err) {
        console.warn(`[Backfill] pullpush unavailable for "${keyword}":`, err);
      }

      // Dedup by reddit id (pullpush + API often overlap on recent items)
      const seen = new Set<string>();
      const allResults = [...posts, ...comments, ...pullpushResults].filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      let newMatches = 0;

      for (const result of allResults) {
        const redditPost = await prisma.redditPost.upsert({
          where: { redditId: result.id },
          create: {
            redditId: result.id,
            type: result.type,
            title: result.title,
            content: result.content,
            subreddit: result.subreddit,
            author: result.author,
            url: result.url,
            score: result.score,
            numComments: result.numComments,
            createdUtc: result.createdUtc,
            isHistorical: true,
          },
          update: { score: result.score },
        });

        const existing = await prisma.match.findUnique({
          where: {
            userId_keywordId_redditPostId: {
              userId,
              keywordId,
              redditPostId: redditPost.id,
            },
          },
        });

        if (!existing) {
          await prisma.match.create({
            data: { userId, keywordId, redditPostId: redditPost.id, notified: true }, // historical = no alert
          });

          // Update daily stats for historical posts
          const date = new Date(result.createdUtc);
          date.setUTCHours(0, 0, 0, 0);
          await prisma.dailyStats.upsert({
            where: { userId_keywordId_date: { userId, keywordId, date } },
            create: { userId, keywordId, date, count: 1 },
            update: { count: { increment: 1 } },
          });

          newMatches++;
        }
      }

      console.log(`[Backfill] "${keyword}" complete: ${newMatches} new historical matches`);
    } catch (err) {
      console.error(`[Backfill] Error for "${keyword}":`, err);
    }
  },
  { connection, concurrency: 2 }
);

// Daily digest worker — fires hourly, sends to users whose local hour matches their digestTime.
function userLocalHour(timezone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(new Date());
    // "24" can come back from Intl in some locales for midnight — normalize.
    return Number(hour) % 24;
  } catch {
    return new Date().getUTCHours();
  }
}

export const digestWorker = new Worker(
  "daily-digest",
  async () => {
    const { sendDailyDigest } = await import("../lib/email");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    const allCandidates = await prisma.user.findMany({
      where: { digestEnabled: true },
      include: {
        keywords: {
          where: { active: true },
          include: {
            matches: {
              where: {
                createdAt: { gte: yesterday },
                digestSent: false,
              },
              include: { redditPost: true },
            },
          },
        },
      },
    });

    // Filter to users whose configured digestTime hour matches the current local hour in their tz.
    const users = allCandidates.filter((u: typeof allCandidates[number]) => {
      const targetHour = Number((u.digestTime || "09:00").split(":")[0]);
      return userLocalHour(u.timezone || "UTC") === targetHour;
    });
    console.log(`[Digest] tick — ${users.length}/${allCandidates.length} users due this hour`);

    for (const user of users) {
      const matchGroups = user.keywords
        .filter((kw) => kw.matches.length > 0)
        .map((kw) => ({
          keyword: kw.keyword,
          posts: kw.matches.map((m) => ({
            title: m.redditPost.title ?? undefined,
            subreddit: m.redditPost.subreddit,
            author: m.redditPost.author,
            url: m.redditPost.url,
            type: m.redditPost.type,
            createdUtc: m.redditPost.createdUtc,
          })),
        }));

      if (matchGroups.length === 0) continue;

      const totalMatches = matchGroups.reduce((sum, g) => sum + g.posts.length, 0);
      const subredditCounts: Record<string, number> = {};
      matchGroups.forEach((g) =>
        g.posts.forEach((p) => {
          subredditCounts[p.subreddit] = (subredditCounts[p.subreddit] || 0) + 1;
        })
      );
      const topSubreddits = Object.entries(subredditCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s]) => s);

      const trendingKeyword = matchGroups.sort((a, b) => b.posts.length - a.posts.length)[0]?.keyword || "—";

      try {
        await sendDailyDigest({
          userEmail: user.email!,
          userName: user.name,
          matches: matchGroups,
          date: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
          totalMatches,
          topSubreddits,
          trendingKeyword,
        });

        // Mark as sent
        const matchIds = user.keywords.flatMap((kw) => kw.matches.map((m) => m.id));
        await prisma.match.updateMany({
          where: { id: { in: matchIds } },
          data: { digestSent: true },
        });

        console.log(`[Digest] Sent to ${user.email}`);
      } catch (err) {
        console.error(`[Digest] Failed for ${user.email}:`, err);
      }
    }
  },
  { connection, concurrency: 1 }
);

// Register repeating jobs on boot. Safe to call multiple times — BullMQ dedupes
// repeatable jobs by their key, so restarting the worker won't create duplicates.
(async () => {
  await scheduleMonitorJob();
  await scheduleDailyDigest();
  console.log("[Schedule] monitor every 2m, digest tick every hour");
})().catch((err) => console.error("[Schedule] failed:", err));

console.log("🚀 Redman workers started");
