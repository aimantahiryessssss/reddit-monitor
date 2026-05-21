# Keyword Alert — Reddit Social Listening

Track up to 10 keywords on Reddit. Get instant email alerts on new mentions, plus a daily digest at the time you choose in your timezone. Includes deep historical backfill (Reddit API + pullpush.io mirror) so you can see every past mention the moment you add a keyword.

## Stack

- **Next.js 15** + React 19 + Tailwind 4 (App Router)
- **NextAuth v5** — email/password (Google OAuth optional)
- **Prisma 5** + Postgres
- **BullMQ** + Redis — monitor poller, historical backfill, hourly digest tick, notification queue
- **Resend** — transactional email
- **Reddit API** (snoowrap) for live + recent; **pullpush.io** for deep history

## Deploy

See **[DEPLOY.md](./DEPLOY.md)** for the Railway all-in-one deploy walkthrough (web + worker + Postgres + Redis in one project, ~10 minutes).

## Preview locally in 2 minutes — no Postgres, Redis, or Reddit creds needed

Spins up a SQLite-backed copy seeded with a demo user, 6 keywords, and 14 days of fake matches so every screen looks alive.

```bash
npm install
npm run preview:setup    # creates prisma/preview.db and seeds it (run once)
npm run preview          # starts the app at http://localhost:3000
```

Then open http://localhost:3000/login and sign in:

- email: `demo@keywordalert.app`
- password: `demo1234`

The Reddit poller and background worker stay off in preview mode — you're looking at seeded data. To run the real thing with live Reddit polling, use the section below.

## Run locally (real Reddit polling)

```bash
cp .env.example .env   # fill in DATABASE_URL, REDIS_URL, Reddit creds, Resend, NEXTAUTH_SECRET
npm install
npm run db:push        # create schema
npm run dev            # web on http://localhost:3000
npm run worker         # background worker (separate terminal)
```

> Switching between modes: `npm install` regenerates the Prisma client from the Postgres schema. After installing, re-run `npm run preview:setup` if you want to go back to preview mode.

## Architecture

- **Web** (`npm start`) — Next.js app, serves UI + API routes.
- **Worker** (`npm run worker`) — long-lived process that runs four BullMQ workers and registers two repeating jobs on boot:
  - `monitorWorker` — fires every 2 min, polls Reddit search for posts + comments matching each active keyword, inserts new matches, increments `DailyStats`, and enqueues an email if `instantAlerts && emailAlerts` are on.
  - `backfillWorker` — fires once per `POST /api/keywords`, pulls deep history from pullpush.io (up to 500 items, 2 years back) plus a Reddit API top-up, dedupes, inserts as `isHistorical: true`.
  - `notifyWorker` — sends individual match-alert emails via Resend.
  - `digestWorker` — fires hourly; sends a digest to users whose local hour matches their configured `digestTime`.

## Key files

- [src/lib/reddit.ts](./src/lib/reddit.ts) — Reddit + pullpush clients
- [src/lib/queue.ts](./src/lib/queue.ts) — BullMQ queue definitions + schedulers
- [src/workers/index.ts](./src/workers/index.ts) — all four background workers
- [prisma/schema.prisma](./prisma/schema.prisma) — User / Keyword / RedditPost / Match / DailyStats
