// Test pullpush with and without the `after` parameter our function sends.
const now = Math.floor(Date.now() / 1000);
const yearAgo = now - 86400 * 365;

const tests = [
  { name: "no after, no quotes",   url: `https://api.pullpush.io/reddit/search/comment?q=social+champ&size=100` },
  { name: "no after, quoted",      url: `https://api.pullpush.io/reddit/search/comment?q=%22social+champ%22&size=100` },
  { name: "WITH after, no quotes", url: `https://api.pullpush.io/reddit/search/comment?q=social+champ&size=100&after=${yearAgo}` },
  { name: "WITH after, quoted",    url: `https://api.pullpush.io/reddit/search/comment?q=%22social+champ%22&size=100&after=${yearAgo}` },
];

for (const t of tests) {
  try {
    const res = await fetch(t.url, { headers: { "User-Agent": "KeywordAlert/1.0 probe" } });
    const json = await res.json();
    const raw = json.data?.length ?? 0;
    const phrase = (json.data ?? []).filter((c) => (c.body ?? "").toLowerCase().includes("social champ")).length;
    console.log(`[${t.name}] status=${res.status} raw=${raw} phrase=${phrase}`);
  } catch (e) {
    console.log(`[${t.name}] error: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 500));
}
