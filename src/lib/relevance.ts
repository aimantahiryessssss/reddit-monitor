/**
 * Heuristic "buyer-intent" scorer for Reddit posts about SMM-tool topics.
 *
 * Plain keyword matches return a lot of noise — e.g. searching "social media
 * management" surfaces career advice, internship asks, and random anecdotes
 * alongside the actual people shopping for a tool. This module scores each
 * post on signals that correlate with someone being a potential customer
 * (asking for tool recommendations, comparing options, complaining about a
 * specific workflow) and filters out signals that correlate with non-buyers
 * (career-seekers, hiring posts, generic chatter).
 *
 * Rule-based, no LLM. Cheap, deterministic, transparent. Tradeoff: it misses
 * edge cases an LLM would catch and occasionally over-filters.
 */

const TOOL_SIGNALS = [
  "tool",
  "tools",
  "software",
  "platform",
  "scheduler",
  "scheduling",
  "automate",
  "automation",
  "saas",
  "app for",
];

const COMPARISON_SIGNALS = [
  " vs ",
  " vs.",
  "versus",
  "alternative",
  "alternatives",
  "instead of",
  "better than",
  "switching from",
  "switch from",
  "moving from",
  "replace",
  "replacement for",
];

const INTENT_SIGNALS = [
  "best ",
  "recommend",
  "recommendation",
  "suggest",
  "suggestion",
  "favorite",
  "which one",
  "which is",
  "looking for",
  "need a ",
  "need an ",
  "trying to find",
  "anyone use",
  "anyone using",
  "anyone tried",
  "any good",
  "what tool",
  "what platform",
  "what software",
  "how do you ",
  "how do you manage",
  "how do you handle",
  "help me find",
  "any suggestions",
  "any recommendations",
];

// Pain-point phrases — someone complaining about a workflow is a hot buyer.
const PAIN_SIGNALS = [
  "frustrated",
  "annoying",
  "struggling with",
  "struggle to",
  "hate ",
  "tired of",
  "pain point",
  "wasted",
  "wasting time",
  "manually",
  "spreadsheet",
  "doing it by hand",
];

// Phrases that mean the post is about CAREER/HIRING, not tool purchase.
const NEGATIVE_SIGNALS = [
  "how to become",
  "how to start a career",
  "how to learn",
  "career advice",
  "career path",
  "internship",
  "is hiring",
  "we're hiring",
  "now hiring",
  "looking to hire",
  "salary",
  "resume",
  "got my first job",
  "freelance rate",
  "what to charge",
  "education in",
];

// Subreddits where SMM-tool buyer intent is over-represented.
const HIGH_INTENT_SUBS = new Set(
  [
    "SocialMediaMarketing",
    "socialmedia",
    "SaaS",
    "SocialMediaManagers",
    "SMM_EXPERTS",
    "SocialMediaSchedulers",
    "marketing",
    "DigitalMarketing",
    "Entrepreneur",
    "smallbusiness",
    "agency",
    "AgencyLife",
    "GrowthHacking",
  ].map((s) => s.toLowerCase())
);

function countHits(text: string, signals: string[]): number {
  let n = 0;
  for (const s of signals) if (text.includes(s)) n++;
  return n;
}

export interface ScorableItem {
  title?: string | null;
  content?: string | null;
  subreddit?: string | null;
}

/**
 * Returns 0–100ish where higher = more likely a real tool-buyer.
 * Components are additive; designed so a post can score well via title
 * OR body, not requiring both.
 */
export function intentScore(item: ScorableItem): number {
  const title = (item.title ?? "").toLowerCase();
  const body = (item.content ?? "").toLowerCase();
  const text = `${title} ${body}`;

  let score = 0;
  score += countHits(text, TOOL_SIGNALS) * 8;
  score += countHits(text, COMPARISON_SIGNALS) * 14;
  score += countHits(text, INTENT_SIGNALS) * 10;
  score += countHits(text, PAIN_SIGNALS) * 6;

  // Title-level boosts (titles weigh more than body for intent).
  if (title.includes("?")) score += 6;
  if (countHits(title, INTENT_SIGNALS) > 0) score += 8;
  if (countHits(title, COMPARISON_SIGNALS) > 0) score += 8;

  // Subreddit prior — being in an SMM-relevant sub adds confidence.
  const sub = (item.subreddit ?? "").toLowerCase();
  if (HIGH_INTENT_SUBS.has(sub)) score += 6;

  // Negative signals — strong penalty, can take a borderline post below threshold.
  const negHits = countHits(text, NEGATIVE_SIGNALS);
  score -= negHits * 20;

  return Math.max(0, score);
}

export const HIGH_INTENT_THRESHOLD = 15;

export function isHighIntent(item: ScorableItem): boolean {
  return intentScore(item) >= HIGH_INTENT_THRESHOLD;
}

/* ============================================================
 * BRAND-RELEVANCE scoring
 * ============================================================
 * Different lens from intentScore. When the tracked keyword IS a brand
 * (e.g. "Social Champ", "Hootsuite", a competitor), we don't care whether
 * a post is generic "buyer intent" — we care whether the post is actually
 * DISCUSSING the brand: reviews, comparisons, questions about it,
 * complaints, decision-making.
 *
 * Penalises drive-by mentions (brand listed in a long random list, brand
 * in a signature/promo footer, brand in unrelated content).
 */

const BRAND_OPINION_SIGNALS = [
  "love", "loved", "loving",
  "hate", "hated",
  "amazing", "awesome", "great",
  "terrible", "awful", "bad",
  "experience with", "my experience",
  "review", "reviews", "honest review",
  "thoughts on", "opinion on", "opinions on",
  "feel about", "feels about",
  "worth it", "not worth",
];

const BRAND_DECISION_SIGNALS = [
  "should i use", "should i try", "should i switch", "should i get",
  "considering", "thinking about", "thinking of",
  "looking at", "looking into",
  "pricing", "subscription", "free trial", "trial of",
  "switching to", "switching from",
  "moved to", "moving to",
  "tried ", "trying ",
  "anyone use", "anyone using", "anyone tried", "anyone tried out",
  "is it good", "is it worth", "any good",
  "vs ", " vs.", "versus",
  "alternative to", "alternatives to",
  "compared to", "compare ",
  "instead of",
  "recommend", "recommendation", "recommendations",
];

const BRAND_COMPLAINT_SIGNALS = [
  "issue with", "issues with",
  "problem with", "problems with",
  "bug", "buggy",
  "broken", "doesn't work", "not working",
  "support", "customer service",
  "refund", "cancelled", "canceled",
  "stopped using", "switched away",
];

// Phrases that suggest the mention is promotional/self-serving rather than
// organic discussion — penalise these heavily.
const BRAND_PROMO_SIGNALS = [
  "check out my", "shameless plug",
  "we built", "we launched", "we made",
  "i built", "i launched", "i made",
  "founder of", "ceo of",
  "promo code", "discount code", "use code",
  "affiliate",
];

// Freelancer / service-offer / job-seeker / hiring language. A post can
// share lots of category vocabulary with the user's pitch ("social media
// management", "scheduling", "content") while being a freelance pitch or
// résumé rather than a real discussion of buying a tool in that category.
// Penalised heavily and independently of BRAND_PROMO_SIGNALS so personal-
// service drive-by mentions get filtered even when no self-built-product
// promo language is present.
const BRAND_SERVICE_OFFER_SIGNALS = [
  "looking for opportunities",
  "available for",
  "available for paid",
  "available for hire",
  "open to work",
  "open for work",
  "hire me",
  "dm me",
  "message me",
  "feel free to reach out",
  "reach out to me",
  "i can assist",
  "services i can",
  "services i offer",
  "i offer",
  "i provide",
  "i specialize",
  "currently looking",
  "looking for clients",
  "looking for projects",
  "looking for work",
  "freelance",
  "freelancer",
  "lead generation",
  "outreach",
  "cold outreach",
  "promotional content",
  "business profile management",
  "flyer design",
  "my portfolio",
  "my services",
  "rates",
  "my rate",
  "per hour",
  "per project",
  "is hiring",
  "we're hiring",
  "now hiring",
  // Job-seeker / career-advice patterns
  "looking for a job",
  "looking for job",
  "looking for a second job",
  "second job",
  "side hustle",
  "side gig",
  "job search",
  "career advice",
  "career path",
  "what careers",
  "what career",
  "which career",
  "best career",
  "switching careers",
  "switching career",
  "change careers",
  "career change",
  "got laid off",
  "laid off",
  "unemployed",
  "remote job",
  "remote work",
  "wfh job",
  "entry level",
  "entry-level",
  "no experience",
  "internship",
  "intern position",
  // Health / off-topic life posts that brush past category words
  "chronic",
  "headaches",
  "migraine",
  "anxiety ruining",
  "ruining my",
];

/**
 * Returns 0–100ish score for how meaningfully a post discusses `brand`.
 * Higher = post is genuinely about the brand. Used to filter out noisy
 * drive-by mentions when a user is tracking their own brand name.
 */
// Common-word filter for extracting meaningful tokens from a user's brand
// description. Anything in here gets dropped before overlap-scoring so that
// generic words like "tool", "the", "for" don't trivially match every post.
const STOPWORDS = new Set([
  "a","an","the","and","or","but","for","of","to","in","on","at","by","is","it","its","this","that","these","those",
  "with","without","from","as","be","are","was","were","been","being","have","has","had","do","does","did",
  "tool","tools","app","apps","platform","software","service","services","solution","product","saas",
  "your","my","our","we","i","you","they","them","us","me","also","more","most","very","just","can",
  "use","using","used","get","make","makes","made","like","one","other","into","about","over","up","down",
  "all","any","some","each","every","not","no","yes","so","than","then","too",
]);

/**
 * Pulls "meaningful" lowercase tokens out of a free-text description.
 * - lowercases
 * - splits on non-word characters
 * - drops <=3 char tokens and stopwords
 * - de-dupes
 *
 * For "Social media management tool for scheduling posts and analytics" you
 * get something like: ["social","media","management","scheduling","posts","analytics"].
 */
export function extractContextTokens(context: string): string[] {
  if (!context) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of context.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length <= 3) continue;
    if (STOPWORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/**
 * Returns 0–100ish score for how meaningfully a post discusses `brand`.
 * Higher = post is genuinely about the brand. Used to filter out noisy
 * drive-by mentions when a user is tracking their own brand name.
 *
 * When `context` is provided (e.g. "social media management SaaS"), the
 * scorer ALSO requires the post to share vocabulary with that description —
 * otherwise posts like "Hi I'm offering social media services, contact me"
 * that happen to contain the brand string get filtered out.
 */
export function brandRelevanceScore(
  item: ScorableItem,
  brand: string,
  context?: string,
): number {
  const title = (item.title ?? "").toLowerCase();
  const body = (item.content ?? "").toLowerCase();
  const text = `${title} ${body}`;
  const needle = brand.toLowerCase().trim();
  if (!needle) return 0;

  // Baseline: must actually mention the brand. (refreshKeyword already
  // enforces this but be defensive.)
  if (!text.includes(needle)) return 0;

  let score = 10; // baseline for any mention

  // Title mention is a much stronger relevance signal than body mention.
  if (title.includes(needle)) score += 18;

  // Repeated mentions = the post is actually about this brand, not a passing tag.
  const occurrences = text.split(needle).length - 1;
  if (occurrences >= 2) score += 8;
  if (occurrences >= 4) score += 6;

  // Opinion / decision / complaint context near the brand mention.
  score += countHits(text, BRAND_OPINION_SIGNALS) * 8;
  score += countHits(text, BRAND_DECISION_SIGNALS) * 9;
  score += countHits(text, BRAND_COMPLAINT_SIGNALS) * 7;

  // Question mark in title = someone asking about the brand specifically.
  if (title.includes("?") && title.includes(needle)) score += 8;

  // Comparison context — "X vs Brand", "alternatives to Brand" — high signal.
  if (countHits(title, ["vs ", " vs.", "versus", "alternative", "alternatives"]) > 0) score += 10;

  // Penalties.
  score -= countHits(text, BRAND_PROMO_SIGNALS) * 18;

  // Freelance / service-offer / job-seeker language — these posts almost
  // never represent a real buyer of a tool in this category, even when they
  // share vocabulary with the user's pitch. Two or more hits = the post is
  // unambiguously a freelance pitch / job hunt / career-advice thread and
  // should be hard-blocked regardless of other signals.
  const serviceHits = countHits(text, BRAND_SERVICE_OFFER_SIGNALS);
  if (serviceHits >= 2) return 0;
  score -= serviceHits * 25;

  // Long post + only one brand mention = probably a passing reference.
  if (body.length > 800 && occurrences <= 1 && !title.includes(needle)) score -= 12;

  // === Product-context overlap ===
  // When the user tells us what their tool actually IS, require the post to
  // share vocabulary with that description AND ALSO carry some product-
  // shopping signal. A "social media management" tool shouldn't match a
  // freelancer offering social media management services just because the
  // category words overlap.
  if (context) {
    const tokens = extractContextTokens(context);
    if (tokens.length > 0) {
      let overlap = 0;
      for (const t of tokens) if (text.includes(t)) overlap++;

      if (overlap === 0) {
        // No vocabulary overlap with the user's product description means
        // the post is in a different category entirely (e.g. "mobile proxies"
        // when the user's pitch is about social media management). Hard-block.
        return 0;
      } else if (overlap === 1) {
        // One shared token isn't enough — many off-topic posts will share
        // a single category word. Treat as weak signal, small penalty.
        score -= 8;
      } else {
        // 2+ shared tokens = confident vocabulary overlap.
        score += Math.min(overlap * 5, 18);
      }

      // Even with overlap, require some buying / discussion signal nearby —
      // otherwise it's likely a freelancer or generic chatter post.
      const hasBuyingSignal =
        countHits(text, BRAND_OPINION_SIGNALS) +
        countHits(text, BRAND_DECISION_SIGNALS) +
        countHits(text, BRAND_COMPLAINT_SIGNALS) > 0;
      if (!hasBuyingSignal) score -= 15;
    }
  }

  return Math.max(0, score);
}

export const BRAND_RELEVANCE_THRESHOLD = 18;

export function isBrandRelevant(item: ScorableItem, brand: string, context?: string): boolean {
  return brandRelevanceScore(item, brand, context) >= BRAND_RELEVANCE_THRESHOLD;
}
