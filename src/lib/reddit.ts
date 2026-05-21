import Snoowrap from "snoowrap";

let redditClient: Snoowrap | null = null;

export function getRedditClient(): Snoowrap {
  if (!redditClient) {
    redditClient = new Snoowrap({
      userAgent: process.env.REDDIT_USER_AGENT || "RedditMonitor/1.0",
      clientId: process.env.REDDIT_CLIENT_ID!,
      clientSecret: process.env.REDDIT_CLIENT_SECRET!,
      username: process.env.REDDIT_USERNAME!,
      password: process.env.REDDIT_PASSWORD!,
    });

    redditClient.config({
      requestDelay: 1000,
      continueAfterRatelimitError: true,
      retryErrorCodes: [502, 503, 504, 522],
      maxRetryAttempts: 3,
    });
  }
  return redditClient;
}

export interface RedditSearchResult {
  id: string;
  type: "post" | "comment";
  title?: string;
  content?: string;
  subreddit: string;
  author: string;
  url: string;
  score: number;
  numComments?: number;
  createdUtc: Date;
  isHistorical: boolean;
}

export async function searchRedditPosts(
  keyword: string,
  options: { limit?: number; after?: string; historical?: boolean } = {}
): Promise<RedditSearchResult[]> {
  const r = getRedditClient();
  const { limit = 25, historical = false } = options;
  const results: RedditSearchResult[] = [];

  try {
    // Search posts
    const searchResults = await r.search({
      query: keyword,
      sort: "new",
      time: historical ? "all" : "day",
      limit,
    });

    for (const post of searchResults as any[]) {
      results.push({
        id: `t3_${post.id}`,
        type: "post",
        title: post.title || "",
        content: post.selftext || "",
        subreddit: post.subreddit?.display_name || post.subreddit_name_prefixed || "",
        author: post.author?.name || "[deleted]",
        url: `https://reddit.com${post.permalink}`,
        score: post.score || 0,
        numComments: post.num_comments || 0,
        createdUtc: new Date((post.created_utc || 0) * 1000),
        isHistorical: historical,
      });
    }
  } catch (error) {
    console.error(`Error searching Reddit for "${keyword}":`, error);
  }

  return results;
}

export async function searchRedditComments(
  keyword: string,
  options: { limit?: number; historical?: boolean } = {}
): Promise<RedditSearchResult[]> {
  const r = getRedditClient();
  const { limit = 25, historical = false } = options;
  const results: RedditSearchResult[] = [];

  try {
    const commentResults = await (r as any).search({
      query: keyword,
      sort: "new",
      time: historical ? "all" : "day",
      limit,
      type: "comment",
    });

    for (const comment of commentResults as any[]) {
      results.push({
        id: `t1_${comment.id}`,
        type: "comment",
        content: comment.body || "",
        subreddit: comment.subreddit?.display_name || comment.subreddit_name_prefixed || "",
        author: comment.author?.name || "[deleted]",
        url: `https://reddit.com${comment.permalink}`,
        score: comment.score || 0,
        createdUtc: new Date((comment.created_utc || 0) * 1000),
        isHistorical: historical,
      });
    }
  } catch (error) {
    console.error(`Error searching Reddit comments for "${keyword}":`, error);
  }

  return results;
}

/**
 * Deep historical search via pullpush.io (Pushshift mirror).
 * Reddit's own search caps at ~1000 results per query and skews to recent;
 * pullpush exposes the full archive and supports `before`/`after` pagination.
 * Used by the backfill worker, not the live poller.
 */
const PULLPUSH_BASE = "https://api.pullpush.io/reddit/search";

async function fetchPullpush(
  endpoint: "submission" | "comment",
  keyword: string,
  before: number | undefined,
  size: number
): Promise<any[]> {
  const params = new URLSearchParams({
    q: keyword,
    size: String(size),
    sort: "desc",
    sort_type: "created_utc",
  });
  if (before) params.set("before", String(before));

  const res = await fetch(`${PULLPUSH_BASE}/${endpoint}?${params.toString()}`, {
    headers: { "User-Agent": process.env.REDDIT_USER_AGENT || "RedditMonitor/1.0" },
  });
  if (!res.ok) throw new Error(`pullpush ${endpoint} ${res.status}`);
  const json = (await res.json()) as { data?: any[] };
  return json.data ?? [];
}

export interface PullpushOptions {
  /** Max items to retrieve across pages (default 500) */
  maxItems?: number;
  /** Items per page, pullpush caps at 100 (default 100) */
  pageSize?: number;
  /** Oldest UTC second to fetch back to (default: 2 years ago) */
  oldestUtc?: number;
  /** Per-page progress callback (optional) */
  onPage?: (fetched: number) => void;
}

export async function pullpushBackfill(
  keyword: string,
  options: PullpushOptions = {}
): Promise<RedditSearchResult[]> {
  const {
    maxItems = 500,
    pageSize = 100,
    oldestUtc = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 365 * 2,
    onPage,
  } = options;

  const out: RedditSearchResult[] = [];

  for (const endpoint of ["submission", "comment"] as const) {
    let before: number | undefined = undefined;
    let pageCount = 0;
    while (out.length < maxItems && pageCount < Math.ceil(maxItems / pageSize)) {
      let page: any[];
      try {
        page = await fetchPullpush(endpoint, keyword, before, pageSize);
      } catch (err) {
        console.error(`[pullpush] ${endpoint} fetch failed:`, err);
        break;
      }
      if (!page.length) break;

      for (const item of page) {
        if (item.created_utc < oldestUtc) { before = undefined; break; }
        if (endpoint === "submission") {
          out.push({
            id: `t3_${item.id}`,
            type: "post",
            title: item.title || "",
            content: item.selftext || "",
            subreddit: item.subreddit || "",
            author: item.author || "[deleted]",
            url: item.full_link || `https://reddit.com${item.permalink || ""}`,
            score: item.score || 0,
            numComments: item.num_comments || 0,
            createdUtc: new Date(item.created_utc * 1000),
            isHistorical: true,
          });
        } else {
          out.push({
            id: `t1_${item.id}`,
            type: "comment",
            content: item.body || "",
            subreddit: item.subreddit || "",
            author: item.author || "[deleted]",
            url: `https://reddit.com${item.permalink || `/r/${item.subreddit}/comments/${item.link_id?.replace("t3_", "")}/_/${item.id}/`}`,
            score: item.score || 0,
            createdUtc: new Date(item.created_utc * 1000),
            isHistorical: true,
          });
        }
      }

      onPage?.(out.length);
      const last = page[page.length - 1];
      if (!last || last.created_utc < oldestUtc) break;
      before = last.created_utc;
      pageCount++;
      // be polite — pullpush is a free community mirror
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return out;
}
