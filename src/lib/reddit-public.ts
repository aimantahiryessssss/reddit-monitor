/**
 * Credential-free Reddit search using the public JSON endpoints.
 *
 *   https://www.reddit.com/search.json?q=<keyword>&sort=new&t=week
 *
 * Returns the same shape as the OAuth-based reddit.ts so callers can swap
 * between them. Rate limit for unauthenticated requests is ~10/min — fine
 * for on-demand refreshes triggered by the UI.
 */
import type { RedditSearchResult } from "./reddit";

// Reddit aggressively blocks requests from datacenter IPs (like Vercel's) when
// the User-Agent looks bot-like. A browser UA gets through far more often.
const UA = process.env.REDDIT_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type TimeRange = "hour" | "day" | "week" | "month" | "year" | "all";

interface RedditChild {
  kind: string;
  data: {
    id: string;
    name?: string;
    title?: string;
    selftext?: string;
    body?: string;
    subreddit: string;
    author: string;
    permalink: string;
    score: number;
    num_comments?: number;
    created_utc: number;
    link_title?: string;
    link_permalink?: string;
  };
}

interface ListingResponse {
  data: { children: RedditChild[] };
}

// old.reddit.com is the legacy interface — less aggressively rate-limited
// and IP-blocked than www.reddit.com, which makes a meaningful difference
// from datacenter IPs (Vercel, AWS, etc).
const REDDIT_HOST = process.env.REDDIT_HOST || "https://old.reddit.com";

async function fetchListing(path: string): Promise<RedditChild[]> {
  const url = `${REDDIT_HOST}${path}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    // Reddit responds with caching headers; let Next pass them through unchanged.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`reddit ${res.status} for ${url}`);
  }
  const json = (await res.json()) as ListingResponse;
  return json.data?.children ?? [];
}

// Multi-word keywords like `social media scheduler` get tokenized by Reddit's
// search and match any document containing any of the words. Wrapping the
// phrase in double quotes forces an exact-phrase match — which is what users
// actually expect for keyword monitoring.
function buildQuery(keyword: string): string {
  const trimmed = keyword.trim();
  const needsQuotes = /\s/.test(trimmed) && !trimmed.startsWith('"');
  const phrase = needsQuotes ? `"${trimmed}"` : trimmed;
  return encodeURIComponent(phrase);
}

export async function searchPublicPosts(
  keyword: string,
  opts: { limit?: number; t?: TimeRange } = {}
): Promise<RedditSearchResult[]> {
  const { limit = 25, t = "week" } = opts;
  const q = buildQuery(keyword);
  let children: RedditChild[];
  try {
    children = await fetchListing(
      `/search.json?q=${q}&sort=new&t=${t}&limit=${limit}&type=link`
    );
  } catch (err) {
    // Don't kill the whole brand-insights flow on a Reddit 429 / 5xx —
    // return what other sources find.
    console.warn(`[searchPublicPosts] ${(err as Error).message}`);
    return [];
  }
  return children
    .filter((c) => c.kind === "t3")
    .map((c) => ({
      id: `t3_${c.data.id}`,
      type: "post" as const,
      title: c.data.title ?? "",
      content: c.data.selftext ?? "",
      subreddit: c.data.subreddit,
      author: c.data.author || "[deleted]",
      url: `https://reddit.com${c.data.permalink}`,
      score: c.data.score ?? 0,
      numComments: c.data.num_comments ?? 0,
      createdUtc: new Date((c.data.created_utc ?? 0) * 1000),
      isHistorical: false,
    }));
}

// Reddit's `/search.json?type=comment` returns posts whose bodies contain
// the term, not actual comment objects. pullpush.io is the real comment
// search. It caps `size` at 100 per request, so we paginate backwards in
// time with the `before` cursor to sweep the full requested time range.
export async function searchPublicComments(
  keyword: string,
  opts: { limit?: number; t?: TimeRange } = {}
): Promise<RedditSearchResult[]> {
  const { limit = 25, t = "week" } = opts;
  const cutoffSeconds = (() => {
    const now = Math.floor(Date.now() / 1000);
    switch (t) {
      case "hour":  return now - 3600;
      case "day":   return now - 86400;
      case "week":  return now - 86400 * 7;
      case "month": return now - 86400 * 30;
      case "year":  return now - 86400 * 365;
      case "all":   return 0;
    }
  })();

  const PAGE_SIZE = 100;
  const target = Math.max(limit, 500);
  const maxPages = Math.ceil(target / PAGE_SIZE);
  const trimmed = keyword.trim();
  // pullpush DOES honor quoted phrase search (verified empirically: bare
  // `q=social champ` returns 95% noise, `q="social champ"` returns 98%
  // phrase-confirmed). Always quote multi-word brands.
  const q = /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;

  const collected: RedditSearchResult[] = [];
  const seen = new Set<string>();
  let before: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    // NOTE: pullpush's `after` parameter is broken on the current mirror —
    // sending it returns 0-1 results regardless of `q`. We paginate backward
    // with `before` only, and apply the time cutoff client-side below.
    const params = new URLSearchParams({
      q,
      size: String(PAGE_SIZE),
      sort: "desc",
      sort_type: "created_utc",
    });
    if (before) params.set("before", String(before));

    let items: any[] = [];
    try {
      const res = await fetch(`https://api.pullpush.io/reddit/search/comment?${params}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn(`[pullpush] page ${page} -> ${res.status}, stopping`);
        break;
      }
      const json = (await res.json()) as { data?: any[] };
      items = json.data ?? [];
    } catch (err) {
      console.warn("[pullpush] page failed:", (err as Error).message);
      break;
    }

    if (!items.length) break;

    for (const c of items) {
      // No time cutoff: pullpush.io's archive doesn't update past mid-2025,
      // so applying a "past year" cutoff filters out *everything* it has.
      // Recent data is sourced elsewhere (subreddit-recent + thread deep-scan).
      const id = `t1_${c.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push({
        id,
        type: "comment",
        content: c.body ?? "",
        subreddit: c.subreddit ?? "",
        author: c.author || "[deleted]",
        url: c.permalink
          ? `https://reddit.com${c.permalink}`
          : `https://reddit.com/r/${c.subreddit}/comments/${(c.link_id ?? "").replace("t3_", "")}/_/${c.id}/`,
        score: c.score ?? 0,
        createdUtc: new Date((c.created_utc ?? 0) * 1000),
        isHistorical: t === "all" || t === "year",
      });
    }

    const oldest = items[items.length - 1]?.created_utc;
    if (!oldest) break;
    before = oldest;
    // be polite — pullpush is a free community mirror
    await new Promise((r) => setTimeout(r, 250));
  }

  return collected;
}

/**
 * Fetch a Reddit user's most recent comments straight from Reddit's public
 * user-comments endpoint (no credentials required). Used to find comments
 * the brand owner has made themselves — pullpush.io's comment archive is
 * sparse and laggy, but Reddit's own user endpoint is always current.
 *
 * Returns ALL the user's comments (up to `limit`); the caller filters by
 * keyword. Reddit caps `limit` at 100 per page; we paginate with `after`
 * to pull up to ~1000.
 */
export async function fetchUserComments(
  username: string,
  opts: { maxPages?: number } = {}
): Promise<RedditSearchResult[]> {
  const { maxPages = 10 } = opts;
  const out: RedditSearchResult[] = [];
  let after: string | null = null;
  const clean = username.replace(/^\/?u\//, "").replace(/^u\//, "").trim();

  for (let page = 0; page < maxPages; page++) {
    const url = `${REDDIT_HOST}/user/${encodeURIComponent(clean)}/comments.json?limit=100${after ? `&after=${after}` : ""}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(`User u/${clean} not found or private`);
        }
        throw new Error(`reddit ${res.status} for /user/${clean}/comments.json`);
      }
      const json = (await res.json()) as ListingResponse & { data: { after?: string } };
      const children = json.data?.children ?? [];
      for (const c of children) {
        if (c.kind !== "t1") continue;
        out.push({
          id: `t1_${c.data.id}`,
          type: "comment",
          content: c.data.body ?? "",
          subreddit: c.data.subreddit,
          author: c.data.author || clean,
          url: `https://reddit.com${c.data.permalink ?? ""}`,
          score: c.data.score ?? 0,
          createdUtc: new Date((c.data.created_utc ?? 0) * 1000),
          isHistorical: true,
        });
      }
      if (!json.data.after) break;
      after = json.data.after;
    } catch (err) {
      console.warn("[fetchUserComments] page failed:", (err as Error).message);
      if (page === 0) throw err;
      break;
    }
    // Small delay between pages so Reddit doesn't rate-limit us when this
    // function is called repeatedly during brand-insights author expansion.
    if (page + 1 < maxPages) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return out;
}

/**
 * Pull the comment tree of a single post and return any comments matching
 * the keyword. Reddit's per-post JSON returns the entire flattened tree
 * (with replies nested in `replies.data.children`); we flatten + filter.
 */
export async function fetchPostThreadComments(
  permalink: string,
  keyword: string
): Promise<RedditSearchResult[]> {
  const needle = keyword.toLowerCase().trim();
  if (!needle) return [];

  // permalink format: /r/<sub>/comments/<id>/<slug>/
  const url = `${REDDIT_HOST}${permalink.replace(/\/$/, "")}.json?limit=500`;
  let json: any;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    json = await res.json();
  } catch {
    return [];
  }

  // Reddit returns an array: [postListing, commentsListing]
  const commentsListing = Array.isArray(json) ? json[1] : null;
  if (!commentsListing?.data?.children) return [];

  const found: RedditSearchResult[] = [];

  function walk(node: any) {
    if (!node) return;
    if (node.kind === "t1" && node.data) {
      const body: string = node.data.body ?? "";
      if (body.toLowerCase().includes(needle)) {
        found.push({
          id: `t1_${node.data.id}`,
          type: "comment",
          content: body,
          subreddit: node.data.subreddit,
          author: node.data.author || "[deleted]",
          url: `https://reddit.com${node.data.permalink ?? ""}`,
          score: node.data.score ?? 0,
          createdUtc: new Date((node.data.created_utc ?? 0) * 1000),
          isHistorical: false,
        });
      }
      const replies = node.data.replies;
      if (replies && typeof replies === "object" && replies.data?.children) {
        for (const r of replies.data.children) walk(r);
      }
    }
  }

  for (const top of commentsListing.data.children) walk(top);
  return found;
}

/**
 * Pull the most recent comments from a specific subreddit and keep the ones
 * that mention the keyword. Catches "blind" mentions — comments that mention
 * the brand inside threads that don't have the brand in the post title or
 * body, so the keyword post search wouldn't surface them.
 *
 * Reddit's `/r/<sub>/comments.json` returns up to 100 of the sub's newest
 * comments. Hot/active subreddits churn through 100 comments fast, so this
 * only catches very recent mentions (last few hours to a day for big subs,
 * up to weeks for slow subs).
 */
export async function fetchSubredditRecentComments(
  subreddit: string,
  keyword: string,
  opts: { limit?: number } = {}
): Promise<RedditSearchResult[]> {
  const { limit = 100 } = opts;
  const needle = keyword.toLowerCase().trim();
  if (!needle) return [];

  const url = `${REDDIT_HOST}/r/${encodeURIComponent(subreddit)}/comments.json?limit=${limit}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as ListingResponse;
    const out: RedditSearchResult[] = [];
    for (const c of json.data?.children ?? []) {
      if (c.kind !== "t1") continue;
      const body = (c.data.body ?? "").toLowerCase();
      if (!body.includes(needle)) continue;
      out.push({
        id: `t1_${c.data.id}`,
        type: "comment",
        content: c.data.body ?? "",
        subreddit: c.data.subreddit,
        author: c.data.author || "[deleted]",
        url: `https://reddit.com${c.data.permalink ?? ""}`,
        score: c.data.score ?? 0,
        createdUtc: new Date((c.data.created_utc ?? 0) * 1000),
        isHistorical: false,
      });
    }
    return out;
  } catch (err) {
    console.warn(`[fetchSubredditRecentComments] r/${subreddit} failed:`, (err as Error).message);
    return [];
  }
}

/**
 * Pullpush.io submission search — mirrors Reddit's full post archive.
 *
 * Reddit's own /search.json drops a lot of older posts and is rate-limited
 * to ~10 req/min unauthenticated. pullpush.io's submission archive lets us
 * sweep months/years of historical posts that Reddit search has buried,
 * with phrase-match support (verified empirically the same way as comments:
 * quoted multi-word terms return ~98% phrase-confirmed matches).
 *
 * Caveat: pullpush's archive lags real-time by a few weeks, so this is
 * complementary to Reddit's native search rather than a replacement —
 * Reddit search catches the freshest stuff, pullpush catches the long tail.
 */
export async function searchPullpushPosts(
  keyword: string,
  opts: { limit?: number; t?: TimeRange } = {}
): Promise<RedditSearchResult[]> {
  const { limit = 25, t = "week" } = opts;
  const PAGE_SIZE = 100;
  const target = Math.max(limit, 500);
  const maxPages = Math.ceil(target / PAGE_SIZE);
  const trimmed = keyword.trim();
  const q = /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;

  const collected: RedditSearchResult[] = [];
  const seen = new Set<string>();
  let before: number | null = null;
  const isHistorical = t === "all" || t === "year" || t === "month";

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      q,
      size: String(PAGE_SIZE),
      sort: "desc",
      sort_type: "created_utc",
    });
    if (before) params.set("before", String(before));

    let items: any[] = [];
    try {
      const res = await fetch(`https://api.pullpush.io/reddit/search/submission?${params}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn(`[pullpush submissions] page ${page} -> ${res.status}, stopping`);
        break;
      }
      const json = (await res.json()) as { data?: any[] };
      items = json.data ?? [];
    } catch (err) {
      console.warn("[pullpush submissions] page failed:", (err as Error).message);
      break;
    }

    if (!items.length) break;

    for (const s of items) {
      const id = `t3_${s.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push({
        id,
        type: "post",
        title: s.title ?? "",
        content: s.selftext ?? "",
        subreddit: s.subreddit ?? "",
        author: s.author || "[deleted]",
        url: s.permalink
          ? `https://reddit.com${s.permalink}`
          : `https://reddit.com/r/${s.subreddit}/comments/${s.id}/`,
        score: s.score ?? 0,
        numComments: s.num_comments ?? 0,
        createdUtc: new Date((s.created_utc ?? 0) * 1000),
        isHistorical,
      });
    }

    const oldest = items[items.length - 1]?.created_utc;
    if (!oldest) break;
    before = oldest;
    // Be polite to a free community mirror.
    await new Promise((r) => setTimeout(r, 250));
  }

  return collected;
}

/**
 * SerpAPI-backed Reddit search. Bypasses Reddit's IP block on datacenter
 * traffic (Vercel) by going through Google search results instead. Returns
 * RedditSearchResult shape so callers can mix it with other sources.
 *
 * Each call uses 1 SerpAPI quota credit. Free tier = 100/month. Cap results
 * at 100 per call (the max Google returns in a single page).
 */
export async function searchSerpAPI(
  keyword: string,
  opts: { limit?: number; t?: TimeRange } = {}
): Promise<RedditSearchResult[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn("[serpapi] SERPAPI_KEY not set, skipping");
    return [];
  }

  const { limit = 100, t = "year" } = opts;
  const trimmed = keyword.trim();
  // Quote multi-word terms so Google treats them as a phrase.
  const phrase = /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
  const q = `site:reddit.com ${phrase}`;

  // Google `tbs=qdr:` time filter: h=hour, d=day, w=week, m=month, y=year.
  const tbsMap: Record<TimeRange, string> = {
    hour: "qdr:h", day: "qdr:d", week: "qdr:w",
    month: "qdr:m", year: "qdr:y", all: "",
  };
  const tbs = tbsMap[t];

  const params = new URLSearchParams({
    engine: "google",
    q,
    num: String(Math.min(limit, 100)),
    api_key: apiKey,
  });
  if (tbs) params.set("tbs", tbs);

  let json: any;
  try {
    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[serpapi] ${res.status} for "${keyword}"`);
      return [];
    }
    json = await res.json();
  } catch (err) {
    console.warn(`[serpapi] fetch failed:`, (err as Error).message);
    return [];
  }

  const results = (json.organic_results ?? []) as Array<{
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
  }>;

  const out: RedditSearchResult[] = [];
  for (const r of results) {
    if (!r.link) continue;
    // Parse reddit permalink: /r/<sub>/comments/<postId>/<slug>/<commentId?>
    const m = r.link.match(/reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?/i);
    if (!m) continue;
    const [, subreddit, postId, commentId] = m;
    const isComment = !!commentId;
    const id = isComment ? `t1_${commentId}` : `t3_${postId}`;

    // Parse the "Mar 12, 2025" / "5 days ago" style date Google returns.
    // Fall back to "now" if missing — sort order still favors recents because
    // Google ranks by recency for tbs=qdr filters.
    let createdUtc = new Date();
    if (r.date) {
      const parsed = Date.parse(r.date);
      if (!isNaN(parsed)) createdUtc = new Date(parsed);
    }

    out.push({
      id,
      type: isComment ? "comment" : "post",
      title: r.title?.replace(/\s*[:|—-]\s*r\/.+$/, "") ?? "",
      content: r.snippet ?? "",
      subreddit,
      author: "[via google]",
      url: r.link,
      score: 0,
      numComments: 0,
      createdUtc,
      isHistorical: t === "year" || t === "all",
    });
  }
  return out;
}

export async function searchPublicAll(
  keyword: string,
  opts: { limit?: number; t?: TimeRange } = {}
): Promise<RedditSearchResult[]> {
  // Three parallel sources: Reddit's own search (freshest), pullpush
  // submissions (deepest post archive), pullpush comments (comment archive).
  // De-dupe by ID since pullpush + Reddit will overlap on recent posts.
  const [redditPosts, pullpushPosts, comments] = await Promise.all([
    searchPublicPosts(keyword, opts).catch((e) => {
      console.warn("[reddit-public] posts failed:", (e as Error).message);
      return [] as RedditSearchResult[];
    }),
    searchPullpushPosts(keyword, opts).catch((e) => {
      console.warn("[reddit-public] pullpush posts failed:", (e as Error).message);
      return [] as RedditSearchResult[];
    }),
    searchPublicComments(keyword, opts).catch((e) => {
      console.warn("[reddit-public] comments failed:", (e as Error).message);
      return [] as RedditSearchResult[];
    }),
  ]);

  const merged = new Map<string, RedditSearchResult>();
  // Reddit's results win on conflict — they have fresher score/comment counts
  // than pullpush's snapshot-at-archive-time.
  for (const r of pullpushPosts) merged.set(r.id, r);
  for (const r of redditPosts) merged.set(r.id, r);
  for (const r of comments) merged.set(r.id, r);
  return Array.from(merged.values());
}
