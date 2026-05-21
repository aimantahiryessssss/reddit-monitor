'use client';

import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Search, BarChart3, TrendingUp, TrendingDown, Minus, ExternalLink, MessageSquare, FileText } from 'lucide-react';

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

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function BrandInsightsPage() {
  const [brand, setBrand] = useState('');
  const [username, setUsername] = useState('');
  const [data, setData] = useState<BrandInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (brand.trim().length < 2) {
      setError('Enter at least 2 characters');
      return;
    }
    setLoading(true);
    setError('');
    setData(null);
    try {
      const params = new URLSearchParams({ brand: brand.trim() });
      if (username.trim()) params.set('username', username.trim());
      const res = await fetch(`/api/brand-insights?${params}`);
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || 'Failed');
      } else {
        setData(j);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const TrendIcon = data?.trend.direction === 'up' ? TrendingUp
    : data?.trend.direction === 'down' ? TrendingDown : Minus;
  const trendColor = data?.trend.direction === 'up' ? 'var(--green)'
    : data?.trend.direction === 'down' ? '#ef4444' : 'var(--text-muted)';

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Brand Insights</h1>
        <p className="page-subtitle">See every Reddit post and comment mentioning your brand, plus how mention volume is trending.</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <form onSubmit={analyze}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <div style={{ position: 'relative', flex: '2 1 280px' }}>
              <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                className="input"
                style={{ paddingLeft: 40 }}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Brand name (e.g. 'Social Champ')"
                disabled={loading}
              />
            </div>
            <div style={{ position: 'relative', flex: '1 1 220px' }}>
              <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', fontSize:14, fontWeight:600 }}>u/</span>
              <input
                className="input"
                style={{ paddingLeft: 32 }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your Reddit username (optional)"
                disabled={loading}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || brand.trim().length < 2}>
              {loading
                ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Analyzing…</>
                : <><BarChart3 size={14} strokeWidth={2.5} /> Analyze</>}
            </button>
          </div>
          <div style={{ marginTop:10, fontSize:12, color:'var(--text-muted)' }}>
            Adding your Reddit username pulls all your recent comments and flags any that mention the brand — useful for finding outreach replies pullpush.io misses.
          </div>
        </form>
        {error && <div style={{ marginTop: 10, fontSize: 13, color: '#ef4444' }}>{error}</div>}
      </div>

      {!data && !loading && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <div className="empty-state-text">No brand analyzed yet</div>
            <div className="empty-state-sub">Type your brand name above and click Analyze to pull every Reddit mention from the past year.</div>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Stat cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Total Mentions</div>
              <div className="stat-value">{data.total}</div>
              <div className="stat-sub">Across posts + comments</div>
              <div className="stat-icon"><BarChart3 size={28} strokeWidth={2} /></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Posts</div>
              <div className="stat-value" style={{ color: data.postCount ? 'var(--blue)' : undefined }}>{data.postCount}</div>
              <div className="stat-sub">Thread-level mentions</div>
              <div className="stat-icon"><FileText size={28} strokeWidth={2} /></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Comments</div>
              <div className="stat-value" style={{ color: data.commentCount ? 'var(--yellow)' : undefined }}>{data.commentCount}</div>
              <div className="stat-sub">In-thread mentions</div>
              <div className="stat-icon"><MessageSquare size={28} strokeWidth={2} /></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">3-Month Trend</div>
              <div className="stat-value" style={{ color: trendColor, display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendIcon size={26} strokeWidth={2.5} />
                {data.trend.direction === 'flat' ? 'Stable' : `${data.trend.changePct > 0 ? '+' : ''}${data.trend.changePct}%`}
              </div>
              <div className="stat-sub">vs previous 3 months ({data.trend.priorTotal} → {data.trend.recentTotal})</div>
              <div className="stat-icon"><TrendingUp size={28} strokeWidth={2} /></div>
            </div>
          </div>

          {/* Monthly trend chart */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Monthly Mentions — 12 month trend</div>
                <div className="card-subtitle">Is &quot;{data.brand}&quot; being talked about more or less?</div>
              </div>
            </div>
            <div className="chart-container" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.monthly} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0E5C4A" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0E5C4A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E3DBC6" />
                  <XAxis dataKey="label" tick={{ fill: '#8A8678', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#8A8678', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#FAF5E7', border: '1px solid #E3DBC6', borderRadius: 8, fontSize: 13 }}
                    labelStyle={{ color: '#0F2620' }}
                    itemStyle={{ color: '#0E5C4A' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#0E5C4A" strokeWidth={2} fill="url(#brandGrad)" name="Mentions" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top subreddits */}
          {data.topSubreddits.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <div className="card-title">Top Subreddits</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {data.topSubreddits.map((s) => (
                  <div key={s.subreddit} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 20 }}>
                    <span className="subreddit-tag">r/{s.subreddit}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two-column posts / comments */}
          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={16} style={{ color: 'var(--blue)' }} />
                  <div className="card-title">Posts ({data.postCount})</div>
                </div>
              </div>
              {data.posts.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <div className="empty-state-text" style={{ fontSize: 13 }}>No posts found</div>
                </div>
              ) : (
                <div className="match-list" style={{ maxHeight: 600, overflowY: 'auto' }}>
                  {data.posts.map((p) => (
                    <div key={p.id} className="match-card">
                      <div className="match-title">{p.title}</div>
                      {p.content && <div className="match-content">{p.content}</div>}
                      <div className="match-meta">
                        <span className="match-meta-item"><span className="subreddit-tag">r/{p.subreddit}</span></span>
                        <span className="match-meta-item">u/{p.author}</span>
                        <span className="match-meta-item">{timeAgo(p.createdUtc)}</span>
                        <a href={p.url} target="_blank" rel="noreferrer"
                          className="btn btn-sm btn-primary"
                          style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 12 }}>
                          Open ↗ <ExternalLink size={11} strokeWidth={2.5} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MessageSquare size={16} style={{ color: 'var(--yellow)' }} />
                  <div className="card-title">Comments ({data.commentCount})</div>
                  {data.username && data.userCommentsFound > 0 && (
                    <span style={{ fontSize:11, padding:'2px 8px', background:'var(--accent-dim)', color:'var(--accent)', borderRadius:20, fontWeight:600 }}>
                      {data.userCommentsFound} by u/{data.username}
                    </span>
                  )}
                </div>
              </div>
              {data.comments.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <div className="empty-state-text" style={{ fontSize: 13 }}>No comments found</div>
                </div>
              ) : (
                <div className="match-list" style={{ maxHeight: 600, overflowY: 'auto' }}>
                  {data.comments.map((c) => (
                    <div key={c.id} className="match-card">
                      <div className="match-content" style={{ WebkitLineClamp: 4 } as React.CSSProperties}>{c.content}</div>
                      <div className="match-meta">
                        <span className="match-meta-item"><span className="subreddit-tag">r/{c.subreddit}</span></span>
                        <span className="match-meta-item">u/{c.author}</span>
                        <span className="match-meta-item">{timeAgo(c.createdUtc)}</span>
                        <a href={c.url} target="_blank" rel="noreferrer"
                          className="btn btn-sm btn-primary"
                          style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 12 }}>
                          Reply ↗ <ExternalLink size={11} strokeWidth={2.5} />
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
    </div>
  );
}
