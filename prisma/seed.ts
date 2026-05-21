/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@keywordalert.app";
const DEMO_PASSWORD = "demo1234";

// Mirrors the keywords visible in the original screenshots.
const KEYWORDS = [
  "social media management tools",
  "social media scheduler",
  "social media scheduling tool",
  "social listening tool",
  "Hootsuite alternatives",
  "Buffer alternatives",
];

const SUBREDDITS = [
  "marketing", "socialmedia", "smallbusiness", "Entrepreneur",
  "SaaS", "digital_marketing", "startups", "Hootsuite",
];

const AUTHORS = [
  "growth_hacker", "ramen_profitable", "marketing_jane", "indie_dev",
  "saasfounder42", "scrappy_seo", "buffer_user", "social_mgr",
];

const POST_TITLES: Record<string, string[]> = {
  "social media management tools": [
    "Best social media management tools in 2026?",
    "Switched from Hootsuite — what management tool are you using?",
    "Cheap social media management tools for a 2-person team",
  ],
  "social media scheduler": [
    "Looking for a reliable social media scheduler under $20/mo",
    "Which scheduler handles Threads + Bluesky together?",
  ],
  "social media scheduling tool": [
    "Free social media scheduling tool that doesn't cap posts?",
  ],
  "social listening tool": [
    "What social listening tool actually catches niche subreddit chatter?",
    "Brand24 vs Mention vs cheaper social listening tool",
  ],
  "Hootsuite alternatives": [
    "Hootsuite alternatives after their 2025 price hike",
    "Hootsuite alternatives that include analytics for free",
    "Anyone tried Social Champ as a Hootsuite alternative?",
  ],
  "Buffer alternatives": [
    "Best Buffer alternatives for agencies managing 15+ clients",
    "Buffer alternatives with native TikTok scheduling",
  ],
};

const COMMENT_BODIES = [
  "I've been using Social Champ for 6 months — the bulk scheduler is the killer feature for me.",
  "+1 for Social Champ. AI captions are surprisingly good.",
  "Honestly the Buffer free tier is enough for most solo founders.",
  "Tried 4 schedulers this year and stuck with one that has a real Bluesky integration.",
  "Social listening tools that scrape Reddit are rare — most just do Twitter and Instagram.",
];

function daysAgo(n: number, hour = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log("→ wiping existing demo data");
  await prisma.match.deleteMany({});
  await prisma.dailyStats.deleteMany({});
  await prisma.keyword.deleteMany({});
  await prisma.redditPost.deleteMany({});
  await prisma.user.deleteMany({});

  console.log(`→ creating demo user (${DEMO_EMAIL} / ${DEMO_PASSWORD})`);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Aimantahir",
      passwordHash,
      timezone: "Asia/Karachi",
      digestTime: "09:00",
      emailAlerts: false,
      instantAlerts: true,
      digestEnabled: true,
    },
  });

  console.log(`→ creating ${KEYWORDS.length} keywords`);
  const keywords = await Promise.all(
    KEYWORDS.map((kw, i) =>
      prisma.keyword.create({
        data: {
          userId: user.id,
          keyword: kw,
          active: true,
          createdAt: daysAgo(13 - i, 9),
        },
      })
    )
  );

  console.log("→ generating fake Reddit posts & matches");
  let redditCounter = 1000;
  for (const kw of keywords) {
    const titles = POST_TITLES[kw.keyword] ?? [];
    // 1 post per title + 2 random comments per keyword
    for (const title of titles) {
      const subreddit = pick(SUBREDDITS);
      const author = pick(AUTHORS);
      const created = daysAgo(Math.floor(Math.random() * 14), 10 + Math.floor(Math.random() * 8));
      const post = await prisma.redditPost.create({
        data: {
          redditId: `t3_seed_${redditCounter++}`,
          type: "post",
          title,
          content: `Looking at options for ${kw.keyword}. Curious what this sub recommends.`,
          subreddit,
          author,
          url: `https://reddit.com/r/${subreddit}/comments/seed_${redditCounter}/`,
          score: 5 + Math.floor(Math.random() * 200),
          numComments: Math.floor(Math.random() * 40),
          createdUtc: created,
          isHistorical: Math.random() > 0.5,
        },
      });
      await prisma.match.create({
        data: {
          userId: user.id,
          keywordId: kw.id,
          redditPostId: post.id,
          notified: Math.random() > 0.4,
          createdAt: created,
        },
      });
    }
    for (let c = 0; c < 2; c++) {
      const subreddit = pick(SUBREDDITS);
      const author = pick(AUTHORS);
      const created = daysAgo(Math.floor(Math.random() * 14), 14);
      const post = await prisma.redditPost.create({
        data: {
          redditId: `t1_seed_${redditCounter++}`,
          type: "comment",
          content: pick(COMMENT_BODIES),
          subreddit,
          author,
          url: `https://reddit.com/r/${subreddit}/comments/seed/${redditCounter}/`,
          score: 1 + Math.floor(Math.random() * 30),
          createdUtc: created,
          isHistorical: Math.random() > 0.5,
        },
      });
      await prisma.match.create({
        data: {
          userId: user.id,
          keywordId: kw.id,
          redditPostId: post.id,
          notified: false,
          createdAt: created,
        },
      });
    }
  }

  console.log("→ building 14 days of daily stats");
  for (const kw of keywords) {
    for (let i = 0; i < 14; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setUTCHours(0, 0, 0, 0);
      // realistic-looking volume — low base with occasional spikes
      const base = Math.floor(Math.random() * 3);
      const spike = Math.random() > 0.85 ? Math.floor(Math.random() * 8) : 0;
      await prisma.dailyStats.create({
        data: {
          userId: user.id,
          keywordId: kw.id,
          date,
          count: base + spike,
        },
      });
    }
  }

  const matchCount = await prisma.match.count();
  console.log(`✓ done. ${KEYWORDS.length} keywords, ${matchCount} matches seeded.`);
  console.log("");
  console.log("  Sign in at http://localhost:3000/login");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
