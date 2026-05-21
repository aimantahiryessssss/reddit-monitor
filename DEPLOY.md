# Deploy to Railway

This deploys the web app, the background worker, Postgres, and Redis into one Railway project. Total time once you have an account: about 10 minutes.

## 0. One-time prep

You need credentials from three places. Get these tabs open before you start:

1. **Reddit app** — https://www.reddit.com/prefs/apps → "create app" → type **script** → note the client id (under the app name) and the client secret. Username/password = a Reddit account you control.
2. **Resend** — https://resend.com → API Keys → create one. Verify a sender domain or use the onboarding sandbox sender.
3. **GitHub** — push this `reddit-monitor` folder to a new GitHub repo. Railway deploys from GitHub.

## 1. Create the Railway project

1. Go to https://railway.com → **New Project** → **Deploy from GitHub repo** → pick the repo you just pushed.
2. Railway will start a first build using the `Dockerfile` in the repo root. Let it run; it will fail or sit unhealthy until env vars are set in step 3.

## 2. Add Postgres + Redis

In the same project:

1. **+ New** → **Database** → **Add PostgreSQL**. Wait for it to provision.
2. **+ New** → **Database** → **Add Redis**. Wait for it to provision.

These plugins expose `DATABASE_URL` and `REDIS_URL` automatically as Railway variables — you just need to reference them on the services (next step).

## 3. Configure the web service

Click the web service tile → **Variables** tab → add the following. Use Railway's **"Add Reference"** for `DATABASE_URL` and `REDIS_URL` so they bind to the plugins, not hardcoded strings.

| Variable | Value |
|---|---|
| `DATABASE_URL` | reference → Postgres → `DATABASE_URL` |
| `REDIS_URL` | reference → Redis → `REDIS_URL` |
| `NEXTAUTH_SECRET` | run `openssl rand -base64 32` locally, paste the output |
| `NEXTAUTH_URL` | your Railway public URL once generated (see step 5) — leave blank for now |
| `REDDIT_CLIENT_ID` | from reddit.com/prefs/apps |
| `REDDIT_CLIENT_SECRET` | from reddit.com/prefs/apps |
| `REDDIT_USERNAME` | your Reddit account username |
| `REDDIT_PASSWORD` | your Reddit account password |
| `REDDIT_USER_AGENT` | something like `KeywordAlert/1.0 by u/yourusername` |
| `RESEND_API_KEY` | from resend.com |
| `EMAIL_FROM` | e.g. `Keyword Alert <alerts@yourdomain.com>` (must be a verified Resend sender) |

## 4. Add the worker service

This is the **same repo, different start command** — that's how BullMQ jobs actually fire.

1. **+ New** → **GitHub Repo** → pick the same repo.
2. Once it appears, open the new service → **Settings** → **Deploy** → **Custom Start Command** → set to:
   ```
   npm run worker
   ```
3. **Variables** tab → click **Shared Variables** and copy all the env vars from the web service (or reference them). The worker needs every variable the web service has.
4. Important — the worker has **no public HTTP port**. In **Settings** → **Networking**, do NOT generate a public domain.

## 5. Generate the public URL + run the schema migration

1. Open the web service → **Settings** → **Networking** → **Generate Domain**. Copy the URL (e.g. `https://keyword-alert-production.up.railway.app`).
2. Go back to **Variables** and set `NEXTAUTH_SECRET`'s sibling `NEXTAUTH_URL` to that exact URL (no trailing slash).
3. Open the web service → **⋯** menu → **Run command** (or use Railway CLI: `railway run`) → run:
   ```
   npx prisma db push
   ```
   This creates all tables in your Postgres. Re-run anytime the schema changes.
4. Redeploy both services (Railway will redeploy automatically when you change vars; if not, hit **Deploy** on each).

## 6. Verify it's alive

1. Visit your Railway URL → you should see the login page.
2. Register an account, log in, add a keyword.
3. Check the **worker** service logs:
   - You should see `[Schedule] monitor every 2m, digest tick every hour` within seconds of boot.
   - When you added the keyword, you should see `[Backfill] Starting historical fetch for "..."` followed by `[Backfill] "..." complete: N new historical matches`.
   - Every 2 minutes you'll see `[Monitor] Found N active keywords`.

If the worker logs are silent: `REDIS_URL` is wrong or unreachable. Re-check the variable reference points to the Redis plugin.

## 7. Custom domain (optional)

Web service → **Settings** → **Networking** → **Custom Domain** → add your domain → set the CNAME record at your DNS provider as instructed. Update `NEXTAUTH_URL` to match, redeploy.

## Cost expectation

Railway's hobby plan is $5/month and includes $5 of usage credit. For one user with 10 keywords running 24/7, you'll comfortably stay under that — Postgres and Redis at idle are cheap, and the worker is mostly waiting on cron ticks. If you scale to dozens of users or aggressive polling (<2 min), watch the dashboard.

## Common gotchas

- **"Invalid \`prisma.user.findUnique()\` invocation"** on first login → you skipped `npx prisma db push`. Run it.
- **No emails arriving** → check Resend dashboard "Emails" tab for errors. Most likely cause: `EMAIL_FROM` uses a domain that isn't verified in Resend.
- **Reddit "401 Unauthorized"** in worker logs → check that the Reddit app type is **script**, not "web app", and that `REDDIT_USERNAME` owns that app.
- **Daily digest never sends** → digest fires hourly but only sends to users whose local hour equals their configured `digestTime` hour. To test, temporarily set your digest time in Settings to the current hour in your timezone, then wait for the top of the next hour.
- **Worker crashes on boot with `Cannot find module 'tsx'`** → make sure you pulled the latest code; `tsx` was moved into `dependencies` (not `devDependencies`) specifically so production installs include it.
