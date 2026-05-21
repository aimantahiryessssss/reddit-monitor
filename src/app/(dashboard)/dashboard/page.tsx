'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format, subDays } from 'date-fns';
import {
  Hash, Activity, Inbox, TrendingUp, TrendingDown, Minus,
  RefreshCw, X, ExternalLink, Plus, Search, BarChart3,
  MessageSquare, FileText, Flame, LayoutDashboard, Filter,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

/* === TYPES === */
interface Keyword {
  id: string;
  keyword: string;
  active: boolean;
  createdAt: string;
  _count: { matches: number };
}
interface DashboardData {
  totalKeywords: number;
  activeKeywords: number;
  matchesToday: number;
  unreadMatches: number;
  topSubreddits: { subreddit: string; count: number }[];
  trendingKeyword: string;
  dailyStats: { date: string; count: number }[];
}
interface BrandInsights {
  brand: string;
  username: string | null;
  total: number;
  postCount: number;
  commentCount: number;
  userCommentsFound: number;
  posts: any[];
  comments: any[];
  monthly: { month: string; label: string; count: number }[];
  trend: { direction: 'up' | 'down' | 'flat'; changePct: number; recentTotal: number; priorTotal: number };
  topSubreddits: { subreddit: string; count: number }[];
}

type TabId = 'overview' | 'feed' | 'brand';

/* === HELPERS === */
// Reddit's default archive rule: posts older than 6 months can't be commented on
// unless the subreddit explicitly disabled archiving. We treat 6 months as the
// likely-archived line and surface the status on each card so users don't
// waste a click on a thread they can't actually reply to.
const ARCHIVE_AGE_MS = 1000 * 60 * 60 * 24 * 30 * 6;
type CommentStatus = { label: string; cls: string; title: string };
function commentStatus(post: any): CommentStatus {
  // `locked` is populated for posts pulled after we added the column;
  // older rows have it undefined and fall through to the age heuristic.
  if (post?.locked === true) {
    return { label: '🔒 locked', cls: 'status-locked', title: 'A moderator locked this thread — no new comments.' };
  }
  if (post?.archived === true) {
    return { label: '📦 archived', cls: 'status-archived', title: 'Reddit archived this thread — commenting disabled.' };
  }
  const created = post?.createdUtc ? new Date(post.createdUtc).getTime() : 0;
  if (created && Date.now() - created > ARCHIVE_AGE_MS) {
    return { label: '📦 likely archived', cls: 'status-archived', title: 'Older than 6 months — commenting probably disabled by Reddit.' };
  }
  return { label: '💬 open', cls: 'status-open', title: 'Comments likely still open.' };
}

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function HomePage() {
  /* === TAB STATE === */
  const [tab, setTab] = useState<TabId>('overview');

  /* === KEYWORDS === */
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [kwInput, setKwInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);

  /* === DASHBOARD === */
  const [data, setData] = useState<DashboardData | null>(null);
  const [hotFeed, setHotFeed] = useState<any[]>([]);
  const [hotTotal, setHotTotal] = useState(0);
  const [activeKeywordId, setActiveKeywordId] = useState<string | null>(null);
  const [activeSubreddit, setActiveSubreddit] = useState<string | null>(null);
  const [brandRelevantOnly, setBrandRelevantOnly] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');

  /* === PRODUCT CONTEXT (helps the relevance filter understand what your tool IS) === */
  const [productName, setProductName] = useState('');
  const [productPitch, setProductPitch] = useState('');
  const [productPanelOpen, setProductPanelOpen] = useState(false);
  const [productSaved, setProductSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('redman.product');
      if (raw) {
        const j = JSON.parse(raw);
        setProductName(j.name ?? '');
        setProductPitch(j.pitch ?? '');
        if (!j.pitch) setProductPanelOpen(true);
      } else {
        setProductPanelOpen(true);
      }
    } catch {}
  }, []);

  function saveProductContext() {
    try {
      localStorage.setItem('redman.product', JSON.stringify({ name: productName.trim(), pitch: productPitch.trim() }));
      setProductSaved(true);
      setTimeout(() => setProductSaved(false), 2500);
      setProductPanelOpen(false);
      // Re-fetch with the new context applied
      fetchHotFeed();
      fetchBrowseFeed();
    } catch {}
  }

  /* === BRAND INSIGHTS === */
  const [brand, setBrand] = useState('');
  const [redditUser, setRedditUser] = useState('');
  const [brandData, setBrandData] = useState<BrandInsights | null>(null);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState('');

  /* === DATA FETCHERS === */
  const fetchKeywords = useCallback(async () => {
    const res = await fetch('/api/keywords');
    if (res.ok) setKeywords((await res.json()).keywords);
  }, []);

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/dashboard');
    if (res.ok) setData(await res.json());
  }, []);

  // Pulls the user's saved product-context pitch (lives in localStorage so
  // we don't need a DB migration). Read at call-time so updates take effect
  // on the next fetch without juggling state-declaration order.
  function readProductPitch(): string {
    try {
      const raw = localStorage.getItem('redman.product');
      if (!raw) return '';
      return (JSON.parse(raw)?.pitch ?? '').toString();
    } catch { return ''; }
  }

  // Today's drops — always bounded to today, regardless of keyword filter.
  // Keyword chip narrows within today, never blows the date window open.
  const fetchHotFeed = useCallback(async () => {
    const params = new URLSearchParams({ limit: '30', since: 'today', kind: 'post' });
    if (activeKeywordId) params.set('keywordId', activeKeywordId);
    if (brandRelevantOnly) {
      params.set('intent', 'brand');
      const ctx = readProductPitch();
      if (ctx) params.set('context', ctx);
    }
    const res = await fetch(`/api/matches?${params}`);
    if (res.ok) {
      const j = await res.json();
      setHotFeed(j.matches);
      setHotTotal(j.total);
    }
  }, [activeKeywordId, brandRelevantOnly]);

  // Historical browse for a single keyword — only fires when user picks one.
  const [browseFeed, setBrowseFeed] = useState<any[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseRawTotal, setBrowseRawTotal] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browsePage, setBrowsePage] = useState(1);
  const BROWSE_PAGE_SIZE = 30;
  const fetchBrowseFeed = useCallback(async () => {
    if (!activeKeywordId) { setBrowseFeed([]); setBrowseTotal(0); setBrowseRawTotal(0); return; }
    setBrowseLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(BROWSE_PAGE_SIZE),
        page: String(browsePage),
        keywordId: activeKeywordId,
        kind: 'post',
      });
      if (brandRelevantOnly) {
        params.set('intent', 'brand');
        const ctx = readProductPitch();
        if (ctx) params.set('context', ctx);
      }
      const res = await fetch(`/api/matches?${params}`);
      if (res.ok) {
        const j = await res.json();
        setBrowseFeed(j.matches);
        setBrowseTotal(j.total);
        setBrowseRawTotal(j.rawTotal ?? j.total);
      }
    } finally {
      setBrowseLoading(false);
    }
  }, [activeKeywordId, brandRelevantOnly, browsePage]);

  useEffect(() => { fetchBrowseFeed(); }, [fetchBrowseFeed]);
  // Reset to page 1 whenever the keyword or filter changes so users don't
  // land on an out-of-range page from a previous keyword.
  useEffect(() => { setBrowsePage(1); }, [activeKeywordId, brandRelevantOnly]);

  useEffect(() => {
    (async () => {
      await Promise.all([fetchKeywords(), fetchData(), fetchHotFeed()]);
    })();
  }, [fetchKeywords, fetchData, fetchHotFeed]);

  function showToast(msg: string, kind: 'success' | 'error' = 'success') {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }

  /* === KEYWORD ACTIONS === */
  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!kwInput.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kwInput.trim() }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error ?? 'Failed', 'error'); return; }
      setKwInput('');
      showToast('Added — pulling Reddit history…');
      await Promise.all([fetchKeywords(), fetchData(), fetchHotFeed()]);
    } finally {
      setAdding(false);
    }
  }
  async function deleteKeyword(id: string) {
    if (!confirm('Delete this keyword and all its matches?')) return;
    const res = await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (activeKeywordId === id) setActiveKeywordId(null);
      await Promise.all([fetchKeywords(), fetchData(), fetchHotFeed()]);
      showToast('Deleted');
    }
  }
  async function refreshFromReddit() {
    setRefreshing(true);
    setRefreshMsg('');
    try {
      const url = activeKeywordId
        ? `/api/live/refresh?keywordId=${activeKeywordId}&t=year`
        : '/api/live/refresh';
      const res = await fetch(url, { method: 'POST' });
      const j = await res.json();
      setRefreshMsg(`Pulled ${j.totalFetched} threads · ${j.totalNew} new`);
      await Promise.all([fetchData(), fetchHotFeed()]);
    } catch (e) {
      setRefreshMsg('Refresh failed: ' + (e as Error).message);
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(''), 6000);
    }
  }

  /* === BRAND INSIGHTS ACTIONS === */
  async function analyzeBrand(e: React.FormEvent) {
    e.preventDefault();
    if (brand.trim().length < 2) {
      setBrandError('Enter at least 2 characters');
      return;
    }
    setBrandLoading(true);
    setBrandError('');
    setBrandData(null);
    try {
      const params = new URLSearchParams({ brand: brand.trim() });
      if (redditUser.trim()) params.set('username', redditUser.trim());
      const res = await fetch(`/api/brand-insights?${params}`);
      const j = await res.json();
      if (!res.ok) setBrandError(j.error ?? 'Failed');
      else setBrandData(j);
    } catch (err) {
      setBrandError((err as Error).message);
    } finally {
      setBrandLoading(false);
    }
  }

  /* === DERIVED === */
  const activeKeyword = activeKeywordId ? keywords.find((k) => k.id === activeKeywordId)?.keyword : null;
  const kwCount = keywords.length;

  const chartData = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = subDays(new Date(), 13 - i);
    const dateStr = format(d, 'yyyy-MM-dd');
    const stat = data?.dailyStats?.find((s) => s.date?.startsWith(dateStr));
    return { date: format(d, 'MMM d'), count: stat?.count || 0 };
  }), [data]);

  const TrendIcon = brandData?.trend.direction === 'up' ? TrendingUp
    : brandData?.trend.direction === 'down' ? TrendingDown : Minus;

  // Hot drops is posts-only — comments would just be drive-by mentions
  // inside threads the user has no context for. Subreddit filter layers on top.
  const visibleFeed = useMemo(() => {
    return hotFeed.filter((m: any) => {
      if (m.redditPost?.type !== 'post') return false;
      if (activeSubreddit && m.redditPost?.subreddit !== activeSubreddit) return false;
      return true;
    });
  }, [hotFeed, activeSubreddit]);

  // Jump to feed tab with a filter applied
  function jumpToFeed(opts?: { keywordId?: string | null; subreddit?: string | null; intent?: boolean }) {
    if (opts?.keywordId !== undefined) setActiveKeywordId(opts.keywordId);
    if (opts?.subreddit !== undefined) setActiveSubreddit(opts.subreddit);
    if (opts?.intent !== undefined) setBrandRelevantOnly(opts.intent);
    setTab('feed');
  }

  const trendingKeywordObj = data?.trendingKeyword
    ? keywords.find((k) => k.keyword === data.trendingKeyword)
    : undefined;

  return (
    <div className="main-stack fade-in">
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.kind === 'error' ? 'toast-error' : 'toast-success'}`}>
            {toast.msg}
          </div>
        </div>
      )}

      {/* === COMPACT HEADER + TABS === */}
      <div className="page-head">
        <div>
          <h1>your reddit radar</h1>
          <div className="page-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="live-dot" /> tracking the internet's loudest room — in real time
          </div>
        </div>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            className={`tab ${tab === 'overview' ? 'tab-active' : ''}`}
            onClick={() => setTab('overview')}
          >
            <LayoutDashboard size={14} /> Vibe check
          </button>
          <button
            role="tab"
            className={`tab ${tab === 'feed' ? 'tab-active' : ''}`}
            onClick={() => setTab('feed')}
          >
            <Flame size={14} /> Hot drops
            {hotTotal > 0 && <span className="tab-badge">{hotTotal}</span>}
          </button>
          <button
            role="tab"
            className={`tab ${tab === 'brand' ? 'tab-active' : ''}`}
            onClick={() => setTab('brand')}
          >
            <BarChart3 size={14} /> Brand tea
          </button>
        </div>
      </div>

      {/* === PRODUCT CONTEXT PANEL ===
          Without this, the brand-relevance filter just looks for the keyword
          string and lets through any post that mentions it. Telling Redman
          what your product actually IS (one line) lets the filter drop
          posts that share the brand name but aren't in your category. */}
      <div className="card" style={{ padding: productPanelOpen ? 22 : '14px 20px', borderStyle: productPitch ? 'solid' : 'dashed' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 22 }}>🧃</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "'Bricolage Grotesque', 'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>
                {productPitch ? `${productName || 'Your tool'} · context locked in` : "tell us what your tool actually is"}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, whiteSpace: productPanelOpen ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {productPitch
                  ? productPitch
                  : 'one line is enough — "X is a Y that does Z" — and we\'ll stop showing you off-topic posts that just happen to share your name.'}
              </div>
            </div>
          </div>
          {productSaved && <span style={{ fontSize: 12, color: 'var(--mint)', fontWeight: 700 }}>✓ saved</span>}
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setProductPanelOpen((v) => !v)}
          >
            {productPanelOpen ? 'Hide' : productPitch ? 'Edit' : 'Set it up'}
          </button>
        </div>
        {productPanelOpen && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px' }}>
                <label className="form-label">Tool name</label>
                <input
                  className="input"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Social Champ"
                  maxLength={60}
                />
              </div>
              <div style={{ flex: '3 1 360px' }}>
                <label className="form-label">One-line pitch</label>
                <input
                  className="input"
                  value={productPitch}
                  onChange={(e) => setProductPitch(e.target.value)}
                  placeholder="e.g. social media management SaaS for scheduling, analytics, and team collab"
                  maxLength={300}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                💡 use category words a buyer would use — &quot;scheduling&quot;, &quot;analytics&quot;, &quot;CRM&quot;, &quot;invoicing&quot; — not marketing copy.
              </div>
              <button className="btn btn-sm btn-accent" onClick={saveProductContext} disabled={!productPitch.trim()}>
                Lock it in
              </button>
            </div>
          </div>
        )}
      </div>

      {/* === COMPACT KEYWORD BAR (always visible) === */}
      <div className="kw-bar">
        <span className="kw-bar-label">On the radar</span>
        <form onSubmit={addKeyword} style={{ display: 'flex', gap: 8, flex: '1 1 280px', minWidth: 240 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="input"
              style={{ paddingLeft: 34, height: 36, fontSize: 13 }}
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              placeholder="drop a keyword…"
              disabled={kwCount >= 10 || adding}
            />
          </div>
          <button className="btn btn-primary" type="submit" style={{ height: 36, padding: '0 14px' }} disabled={kwCount >= 10 || adding || !kwInput.trim()}>
            {adding ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <><Plus size={14} strokeWidth={2.5} /></>}
          </button>
        </form>
        {kwCount === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>kinda empty here — toss in your first keyword ↑</span>
        ) : (
          <div className="kw-grid" style={{ flex: '1 1 auto', gap: 6 }}>
            {keywords.map((kw) => {
              const isActive = activeKeywordId === kw.id;
              return (
                <span
                  key={kw.id}
                  className={`kw-chip ${isActive ? 'kw-active' : ''}`}
                  onClick={() => jumpToFeed({ keywordId: isActive ? null : kw.id })}
                  title={`${kw._count?.matches ?? 0} matches`}
                >
                  <span>{kw.keyword}</span>
                  <button
                    className="kw-chip-x"
                    onClick={(e) => { e.stopPropagation(); deleteKeyword(kw.id); }}
                    title="Delete"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <span className="kw-counter" style={{ fontSize: 12, padding: '4px 10px' }}>{kwCount}/10</span>
      </div>

      {/* === OVERVIEW TAB === */}
      {tab === 'overview' && (
        <div className="tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Stat cards — clickable */}
          <div className="stats-grid" style={{ marginBottom: 0 }}>
            <div
              className={`stat-card clickable ${!activeKeywordId && !activeSubreddit ? '' : ''}`}
              onClick={() => jumpToFeed({ keywordId: null, subreddit: null })}
              title="See all tracked keywords"
            >
              <div className="stat-label">On watch</div>
              <div className="stat-value">
                {data?.activeKeywords ?? 0}
                <span style={{ fontSize: 22, color: 'var(--text-muted)', fontWeight: 500 }}>/{data?.totalKeywords ?? 0}</span>
              </div>
              <div className="stat-sub">slots used · max 10</div>
              <div className="stat-icon"><Hash size={26} strokeWidth={2} /></div>
            </div>
            <div
              className="stat-card clickable"
              onClick={() => jumpToFeed({ keywordId: null, subreddit: null, intent: false })}
              title="Show all matches today"
            >
              <div className="stat-label">Hits today</div>
              <div className="stat-value" style={{ color: data?.matchesToday ? 'var(--accent)' : undefined }}>{data?.matchesToday ?? 0}</div>
              <div className="stat-sub">tap to peek the feed →</div>
              <div className="stat-icon"><Activity size={26} strokeWidth={2} /></div>
            </div>
            <div
              className="stat-card clickable"
              onClick={() => jumpToFeed({ keywordId: null, subreddit: null })}
              title="Open unread"
            >
              <div className="stat-label">Unread</div>
              <div className="stat-value" style={{ color: data?.unreadMatches ? 'var(--accent-3)' : undefined }}>{data?.unreadMatches ?? 0}</div>
              <div className="stat-sub">your turn to weigh in</div>
              <div className="stat-icon"><Inbox size={26} strokeWidth={2} /></div>
            </div>
            <div
              className="stat-card clickable"
              onClick={() => trendingKeywordObj && jumpToFeed({ keywordId: trendingKeywordObj.id })}
              title={trendingKeywordObj ? `Filter feed to "${trendingKeywordObj.keyword}"` : ''}
            >
              <div className="stat-label">Main character</div>
              <div className="stat-value" style={{ fontSize: 22, paddingTop: 10, fontWeight: 700 }}>{data?.trendingKeyword || '—'}</div>
              <div className="stat-sub">trending hardest rn</div>
              <div className="stat-icon"><TrendingUp size={26} strokeWidth={2} /></div>
            </div>
          </div>

          {/* Chart + Top subs */}
          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">📈 chatter over time</div>
                  <div className="card-subtitle">last 14 days · across all keywords</div>
                </div>
                <button className="btn btn-sm btn-accent" onClick={refreshFromReddit} disabled={refreshing}>
                  {refreshing
                    ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Cooking</>
                    : <><RefreshCw size={12} strokeWidth={2.5} /> Refresh</>}
                </button>
              </div>
              {refreshMsg && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{refreshMsg}</div>}
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.42} />
                        <stop offset="95%" stopColor="#FF3D8B" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2D6FF" />
                    <XAxis dataKey="date" tick={{ fill: '#8B85A0', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#8B85A0', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#FFFFFF', border: '2px solid #0A0A0A', borderRadius: 12, fontSize: 13, boxShadow: '3px 3px 0 #0A0A0A' }}
                      labelStyle={{ color: '#0A0A0A', fontWeight: 700 }}
                      itemStyle={{ color: '#7C3AED', fontWeight: 600 }}
                    />
                    <Area type="monotone" dataKey="count" stroke="#7C3AED" strokeWidth={3} fill="url(#grad)" name="Mentions" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">🏆 where it's popping off</div>
                  <div className="card-subtitle">tap a sub to filter the feed</div>
                </div>
              </div>
              {data?.topSubreddits?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.topSubreddits.map((s, i) => {
                    const isActive = activeSubreddit === s.subreddit;
                    return (
                      <div
                        key={s.subreddit}
                        className={`sub-row ${isActive ? 'is-active' : ''}`}
                        onClick={() => jumpToFeed({ subreddit: isActive ? null : s.subreddit })}
                      >
                        <span style={{ fontSize: 13, color: 'var(--text-muted)', width: 18, fontFamily: 'Space Grotesk', fontWeight: 600 }}>{String(i + 1).padStart(2, '0')}</span>
                        <span className="subreddit-tag" style={{ flex: 1 }}>r/{s.subreddit}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Space Grotesk' }}>{s.count}</span>
                        <div style={{ width: 88, height: 6, background: 'var(--bg-soft)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (s.count / (data.topSubreddits[0]?.count || 1)) * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: 24 }}>
                  <div className="empty-state-text" style={{ fontSize: 14 }}>No data yet</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === FEED TAB === */}
      {tab === 'feed' && (
        <div className="tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Headline banner — clearly its own thing */}
          <div className="feed-banner">
            <div className="feed-banner-title">
              <Flame size={22} />
              <span>hot drops today</span>
              {activeKeyword && (
                <span style={{ fontWeight: 600, opacity: 0.9, fontSize: 15 }}>· "{activeKeyword}"</span>
              )}
              {activeSubreddit && (
                <span style={{ fontWeight: 600, opacity: 0.85, fontSize: 15 }}>· r/{activeSubreddit}</span>
              )}
              <span className="feed-banner-count">{visibleFeed.length} of {hotTotal}</span>
            </div>
            <div className="feed-banner-controls">
              <label className="feed-banner-toggle-label">
                <span title="Keeps threads genuinely discussing this brand — reviews, comparisons, decisions, complaints — and drops drive-by mentions.">no fluff, only real ones</span>
                <span className="toggle">
                  <input type="checkbox" checked={brandRelevantOnly} onChange={(e) => setBrandRelevantOnly(e.target.checked)} />
                  <span className="toggle-slider" />
                </span>
              </label>
              <button className="btn btn-sm btn-accent" onClick={refreshFromReddit} disabled={refreshing}>
                {refreshing
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Cooking</>
                  : <><RefreshCw size={12} strokeWidth={2.5} /> Refresh</>}
              </button>
            </div>
          </div>

          {/* Filter strip — visually subordinate */}
          <div className="feed-filters">
            {(activeKeywordId || activeSubreddit) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Filter size={12} style={{ color: 'var(--text-muted)' }} />
                <span className="feed-filters-label" style={{ letterSpacing: '0.10em' }}>Active filters</span>
                {activeKeyword && (
                  <button className="chip chip-active" onClick={() => setActiveKeywordId(null)}>
                    {activeKeyword} <X size={10} strokeWidth={3} style={{ marginLeft: 4 }} />
                  </button>
                )}
                {activeSubreddit && (
                  <button className="chip chip-active" onClick={() => setActiveSubreddit(null)}>
                    r/{activeSubreddit} <X size={10} strokeWidth={3} style={{ marginLeft: 4 }} />
                  </button>
                )}
                <button
                  className="chip"
                  onClick={() => { setActiveKeywordId(null); setActiveSubreddit(null); }}
                  style={{ fontSize: 12 }}
                >
                  Clear all
                </button>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="feed-filters-label">Filter by keyword</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className={`chip ${!activeKeywordId ? 'chip-active' : ''}`}
                  onClick={() => setActiveKeywordId(null)}
                >
                  All keywords
                </button>
                {keywords.map((kw) => (
                  <button
                    key={kw.id}
                    className={`chip ${activeKeywordId === kw.id ? 'chip-active' : ''}`}
                    onClick={() => setActiveKeywordId(kw.id)}
                  >
                    {kw.keyword}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            {visibleFeed.length === 0 ? (
              <div className="empty-state" style={{ padding: 36 }}>
                <div className="empty-state-icon">🔥</div>
                <div className="empty-state-text">
                  {activeSubreddit
                    ? `nothing in r/${activeSubreddit} matching your filters`
                    : activeKeywordId
                      ? `no posts stashed for "${activeKeyword}" yet`
                      : 'crickets so far today'}
                </div>
                <div className="empty-state-sub">tap Refresh to grab the latest tea ☕</div>
              </div>
            ) : (
              <div className="match-list">
                {visibleFeed.map((m: any) => (
                  <div key={m.id} className="match-card">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className={`match-type-badge ${m.redditPost.type === 'post' ? 'type-post' : 'type-comment'}`}>{m.redditPost.type}</span>
                      {(() => { const s = commentStatus(m.redditPost); return <span className={`status-badge ${s.cls}`} title={s.title}>{s.label}</span>; })()}
                      <button
                        className="match-keyword-tag"
                        style={{ border: 'none', cursor: 'pointer' }}
                        onClick={() => setActiveKeywordId(m.keyword.id)}
                        title="Filter by this keyword"
                      >
                        {m.keyword.keyword}
                      </button>
                    </div>
                    {m.redditPost.title && <div className="match-title">{m.redditPost.title}</div>}
                    {m.redditPost.content && <div className="match-content">{m.redditPost.content}</div>}
                    <div className="match-meta">
                      <button
                        className="match-meta-item"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                        onClick={() => setActiveSubreddit(m.redditPost.subreddit)}
                        title="Filter by this subreddit"
                      >
                        <span className="subreddit-tag">r/{m.redditPost.subreddit}</span>
                      </button>
                      <span className="match-meta-item">u/{m.redditPost.author}</span>
                      <span className="match-meta-item">{timeAgo(m.redditPost.createdUtc)}</span>
                      <a href={m.redditPost.url} target="_blank" rel="noreferrer"
                         className="btn btn-sm btn-accent"
                         style={{ marginLeft: 'auto' }}>
                        Slide in <ExternalLink size={11} strokeWidth={2.5} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* === HISTORICAL BROWSE — only when a keyword is picked === */}
          {activeKeywordId && (
            <div className="card" style={{ marginTop: 8 }}>
              <div className="card-header">
                <div>
                  <div className="card-title">📚 the full archive · "{activeKeyword}"</div>
                  <div className="card-subtitle">
                    {(() => {
                      const totalPages = Math.max(1, Math.ceil(browseTotal / BROWSE_PAGE_SIZE));
                      const startIdx = (browsePage - 1) * BROWSE_PAGE_SIZE + 1;
                      const endIdx = Math.min(browsePage * BROWSE_PAGE_SIZE, browseTotal);
                      if (brandRelevantOnly && browseRawTotal > browseTotal) {
                        return (
                          <>showing {startIdx}–{endIdx} of {browseTotal} relevant · page {browsePage}/{totalPages} · {browseRawTotal - browseTotal} dropped by the &quot;no fluff&quot; filter</>
                        );
                      }
                      return <>showing {startIdx}–{endIdx} of {browseTotal} · page {browsePage}/{totalPages}</>;
                    })()}
                  </div>
                </div>
                <button className="btn btn-sm btn-secondary" onClick={() => setActiveKeywordId(null)}>
                  <X size={12} strokeWidth={2.5} /> Close
                </button>
              </div>
              {browseLoading ? (
                <div className="empty-state" style={{ padding: 32 }}>
                  <span className="spinner" /> <span style={{ marginLeft: 10 }}>loading the archive…</span>
                </div>
              ) : browseFeed.length === 0 ? (
                <div className="empty-state" style={{ padding: 32 }}>
                  <div className="empty-state-icon">📭</div>
                  <div className="empty-state-text">nothing stashed yet</div>
                  <div className="empty-state-sub">tap Refresh up top to pull this keyword&apos;s reddit history.</div>
                </div>
              ) : (
                <div className="match-list">
                  {browseFeed
                    .filter((m: any) => m.redditPost?.type === 'post')
                    .filter((m: any) => !activeSubreddit || m.redditPost?.subreddit === activeSubreddit)
                    .map((m: any) => (
                      <div key={m.id} className="match-card">
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span className={`match-type-badge ${m.redditPost.type === 'post' ? 'type-post' : 'type-comment'}`}>{m.redditPost.type}</span>
                          {(() => { const s = commentStatus(m.redditPost); return <span className={`status-badge ${s.cls}`} title={s.title}>{s.label}</span>; })()}
                          <span className="match-keyword-tag">{m.keyword.keyword}</span>
                        </div>
                        {m.redditPost.title && <div className="match-title">{m.redditPost.title}</div>}
                        {m.redditPost.content && <div className="match-content">{m.redditPost.content}</div>}
                        <div className="match-meta">
                          <button
                            className="match-meta-item"
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                            onClick={() => setActiveSubreddit(m.redditPost.subreddit)}
                          >
                            <span className="subreddit-tag">r/{m.redditPost.subreddit}</span>
                          </button>
                          <span className="match-meta-item">u/{m.redditPost.author}</span>
                          <span className="match-meta-item">{timeAgo(m.redditPost.createdUtc)}</span>
                          <a href={m.redditPost.url} target="_blank" rel="noreferrer"
                             className="btn btn-sm btn-accent"
                             style={{ marginLeft: 'auto' }}>
                            Slide in <ExternalLink size={11} strokeWidth={2.5} />
                          </a>
                        </div>
                      </div>
                    ))}
                  {(() => {
                    const totalPages = Math.max(1, Math.ceil(browseTotal / BROWSE_PAGE_SIZE));
                    if (totalPages <= 1) return null;
                    return (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 8, paddingTop: 16, marginTop: 8,
                        borderTop: '1.5px dashed var(--border)',
                      }}>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => { setBrowsePage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          disabled={browsePage === 1 || browseLoading}
                        >
                          <ChevronLeft size={14} strokeWidth={2.5} /> Prev
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13 }}>
                          <span style={{ color: 'var(--grape)' }}>{browsePage}</span>
                          <span style={{ color: 'var(--text-muted)' }}>/ {totalPages}</span>
                        </div>
                        <button
                          className="btn btn-sm btn-accent"
                          onClick={() => { setBrowsePage((p) => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          disabled={browsePage >= totalPages || browseLoading}
                        >
                          Next <ChevronRight size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* === BRAND TAB === */}
      {tab === 'brand' && (
        <div className="tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div className="card-soft">
            <form onSubmit={analyzeBrand}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '2 1 280px' }}>
                  <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 40 }}
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Brand name, e.g. 'Social Champ'"
                    disabled={brandLoading}
                  />
                </div>
                <div style={{ position: 'relative', flex: '1 1 220px' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>u/</span>
                  <input
                    className="input"
                    style={{ paddingLeft: 32 }}
                    value={redditUser}
                    onChange={(e) => setRedditUser(e.target.value)}
                    placeholder="your Reddit username (optional)"
                    disabled={brandLoading}
                  />
                </div>
                <button type="submit" className="btn btn-accent" disabled={brandLoading || brand.trim().length < 2}>
                  {brandLoading
                    ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Snooping</>
                    : <><BarChart3 size={14} strokeWidth={2.5} /> Spill the tea</>}
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                Adding your username surfaces your own brand-mention comments (Reddit doesn&apos;t expose those publicly otherwise).
              </div>
            </form>
            {brandError && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--accent-3)' }}>{brandError}</div>}
          </div>

          {brandData && (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">All the shoutouts</div>
                  <div className="stat-value">{brandData.total}</div>
                  <div className="stat-sub">posts + comments combined</div>
                  <div className="stat-icon"><BarChart3 size={26} strokeWidth={2} /></div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Posts</div>
                  <div className="stat-value" style={{ color: 'var(--blue)' }}>{brandData.postCount}</div>
                  <div className="stat-sub">whole threads about it</div>
                  <div className="stat-icon"><FileText size={26} strokeWidth={2} /></div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Comments</div>
                  <div className="stat-value" style={{ color: 'var(--accent-2)' }}>{brandData.commentCount}</div>
                  <div className="stat-sub">replies and side-takes</div>
                  <div className="stat-icon"><MessageSquare size={26} strokeWidth={2} /></div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">3-month trend</div>
                  <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: 8, color: brandData.trend.direction === 'up' ? 'var(--green)' : brandData.trend.direction === 'down' ? 'var(--accent-3)' : 'var(--text-muted)' }}>
                    <TrendIcon size={32} strokeWidth={2.5} />
                    {brandData.trend.direction === 'flat' ? 'Flat' : `${brandData.trend.changePct > 0 ? '+' : ''}${brandData.trend.changePct}%`}
                  </div>
                  <div className="stat-sub">{brandData.trend.priorTotal} → {brandData.trend.recentTotal}</div>
                  <div className="stat-icon"><TrendingUp size={26} strokeWidth={2} /></div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">📊 the 12-month vibe</div>
                    <div className="card-subtitle">is &quot;{brandData.brand}&quot; getting louder or quieter on reddit?</div>
                  </div>
                </div>
                <div className="chart-container" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={brandData.monthly} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#FF3D8B" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#BEF264" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2D6FF" />
                      <XAxis dataKey="label" tick={{ fill: '#8B85A0', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#8B85A0', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: '#FFFFFF', border: '2px solid #0A0A0A', borderRadius: 12, fontSize: 13, boxShadow: '3px 3px 0 #0A0A0A' }}
                        labelStyle={{ color: '#0A0A0A', fontWeight: 700 }}
                        itemStyle={{ color: '#FF3D8B', fontWeight: 600 }}
                      />
                      <Area type="monotone" dataKey="count" stroke="#FF3D8B" strokeWidth={3} fill="url(#brandGrad)" name="Mentions" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid-2">
                <div className="card">
                  <div className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <FileText size={16} style={{ color: 'var(--blue)' }} />
                      <div className="card-title">Posts ({brandData.postCount})</div>
                    </div>
                  </div>
                  {brandData.posts.length === 0 ? (
                    <div className="empty-state" style={{ padding: 24 }}><div className="empty-state-text" style={{ fontSize: 14 }}>No posts found</div></div>
                  ) : (
                    <div className="match-list" style={{ maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>
                      {brandData.posts.map((p: any) => (
                        <div key={p.id} className="match-card">
                          <div className="match-title">{p.title}</div>
                          {p.content && <div className="match-content">{p.content}</div>}
                          <div className="match-meta">
                            <span className="match-meta-item"><span className="subreddit-tag">r/{p.subreddit}</span></span>
                            <span className="match-meta-item">u/{p.author}</span>
                            <span className="match-meta-item">{timeAgo(p.createdUtc)}</span>
                            <a href={p.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-accent" style={{ marginLeft: 'auto' }}>
                              Open <ExternalLink size={11} strokeWidth={2.5} />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <MessageSquare size={16} style={{ color: 'var(--accent-2)' }} />
                      <div className="card-title">Comments ({brandData.commentCount})</div>
                      {brandData.username && brandData.userCommentsFound > 0 && (
                        <span style={{ fontSize: 11, padding: '3px 9px', background: 'var(--accent-2)', color: 'var(--text-primary)', borderRadius: 'var(--radius-pill)', fontWeight: 700, fontFamily: 'Space Grotesk' }}>
                          {brandData.userCommentsFound} by u/{brandData.username}
                        </span>
                      )}
                    </div>
                  </div>
                  {brandData.comments.length === 0 ? (
                    <div className="empty-state" style={{ padding: 24 }}><div className="empty-state-text" style={{ fontSize: 14 }}>No comments found</div></div>
                  ) : (
                    <div className="match-list" style={{ maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>
                      {brandData.comments.map((c: any) => (
                        <div key={c.id} className="match-card">
                          <div className="match-content" style={{ WebkitLineClamp: 4 } as React.CSSProperties}>{c.content}</div>
                          <div className="match-meta">
                            <span className="match-meta-item"><span className="subreddit-tag">r/{c.subreddit}</span></span>
                            <span className="match-meta-item">u/{c.author}</span>
                            <span className="match-meta-item">{timeAgo(c.createdUtc)}</span>
                            <a href={c.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-accent" style={{ marginLeft: 'auto' }}>
                              Reply <ExternalLink size={11} strokeWidth={2.5} />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {!brandData && !brandLoading && (
            <div className="card-soft">
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-icon">🍵</div>
                <div className="empty-state-text">spill a brand name and we'll spill the tea</div>
                <div className="empty-state-sub">we'll pull a full year of reddit chatter and chart whether the brand is glowing up or flopping.</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
