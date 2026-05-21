'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { RefreshCw, X } from 'lucide-react';

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function MatchesPage() {
  return (
    <Suspense fallback={
      <div style={{ display:'flex', justifyContent:'center', padding:48 }}>
        <span className="spinner" style={{ width:32, height:32, borderWidth:3 }} />
      </div>
    }>
      <MatchesPageInner />
    </Suspense>
  );
}

function MatchesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const keywordId = searchParams.get('keywordId');

  const [matches, setMatches] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'live' | 'historical'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');

  // First match's keyword name is used for the "Filtered by ..." badge.
  const activeKeyword = keywordId && matches.length > 0 ? matches[0].keyword?.keyword : null;

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (filter !== 'all') params.set('type', filter);
    if (keywordId) params.set('keywordId', keywordId);
    const res = await fetch(`/api/matches?${params}`);
    if (res.ok) {
      const data = await res.json();
      setMatches(data.matches);
      setTotal(data.total);
    }
    setLoading(false);
  }, [page, filter, keywordId]);

  // Reset to page 1 when keyword filter changes
  useEffect(() => { setPage(1); }, [keywordId]);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  async function refreshFromReddit() {
    setRefreshing(true);
    setRefreshMsg('');
    try {
      const res = await fetch('/api/live/refresh', { method: 'POST' });
      if (!res.ok) {
        setRefreshMsg('Refresh failed — check the dev console.');
        return;
      }
      const data = await res.json();
      setRefreshMsg(`Pulled ${data.totalFetched} threads from Reddit · ${data.totalNew} new`);
      await fetchMatches();
    } catch (e) {
      setRefreshMsg('Refresh failed — ' + (e as Error).message);
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(''), 6000);
    }
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 className="page-title">Matches Feed</h1>
          <p className="page-subtitle">
            {keywordId
              ? `${total} matches for "${activeKeyword ?? '…'}"`
              : `${total} total matches across all keywords`}
          </p>
          {keywordId && (
            <button
              onClick={() => router.push('/matches')}
              className="filter-pill"
              title="Clear keyword filter"
            >
              Filtered: &quot;{activeKeyword ?? '…'}&quot;
              <X size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {refreshMsg && (
            <span style={{ fontSize:13, color:'var(--text-secondary)' }}>{refreshMsg}</span>
          )}
          <button
            className="btn btn-primary"
            onClick={refreshFromReddit}
            disabled={refreshing}
            title="Pull real Reddit threads for all active keywords"
          >
            {refreshing ? (
              <><span className="spinner" style={{ width:14, height:14 }} /> Fetching…</>
            ) : (
              <><RefreshCw size={14} strokeWidth={2.5} /> Refresh from Reddit</>
            )}
          </button>
        </div>
      </div>

      <div className="tabs">
        {(['all', 'live', 'historical'] as const).map(t => (
          <button key={t} className={`tab ${filter === t ? 'active' : ''}`}
            onClick={() => { setFilter(t); setPage(1); }}>
            {t === 'all' ? '🔴 All' : t === 'live' ? '⚡ Live' : '🕐 Historical'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:48 }}>
          <span className="spinner" style={{ width:32, height:32, borderWidth:3 }} />
        </div>
      ) : matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-text">No matches found</div>
          <div className="empty-state-sub">
            {filter === 'historical' ? 'Historical backfill is still running...' : 'New matches will appear here as Reddit is monitored'}
          </div>
        </div>
      ) : (
        <>
          <div className="match-list">
            {matches.map((m: any) => (
              <div key={m.id} className="match-card">
                <div style={{ display:'flex', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                  <span className={`match-type-badge ${m.redditPost.type === 'post' ? 'type-post' : 'type-comment'}`}>
                    {m.redditPost.type}
                  </span>
                  {m.redditPost.isHistorical && <span className="match-type-badge type-historical">historical</span>}
                  <span className="match-keyword-tag">"{m.keyword.keyword}"</span>
                </div>
                {m.redditPost.title && <div className="match-title">{m.redditPost.title}</div>}
                {m.redditPost.content && <div className="match-content">{m.redditPost.content}</div>}
                <div className="match-meta">
                  <span className="match-meta-item">
                    <span className="subreddit-tag">r/{m.redditPost.subreddit}</span>
                  </span>
                  <span className="match-meta-item">u/{m.redditPost.author}</span>
                  <span className="match-meta-item" title={new Date(m.redditPost.createdUtc).toLocaleString()}>
                    {timeAgo(m.redditPost.createdUtc)}
                  </span>
                  {m.redditPost.score != null && (
                    <span className="match-meta-item">▲ {m.redditPost.score}</span>
                  )}
                  <a href={m.redditPost.url} target="_blank" rel="noreferrer"
                    className="btn btn-sm btn-secondary"
                    style={{ marginLeft:'auto', padding:'4px 12px', fontSize:12 }}>
                    Open Reddit ↗
                  </a>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'center', marginTop:24 }}>
              <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ fontSize:13, color:'var(--text-muted)' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
