'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Activity, Pause, Play, X, ChevronRight } from 'lucide-react';

interface Keyword {
  id: string;
  keyword: string;
  active: boolean;
  createdAt: string;
  _count: { matches: number };
}

export default function KeywordsPage() {
  const router = useRouter();
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchKeywords = useCallback(async () => {
    const res = await fetch('/api/keywords');
    if (res.ok) {
      const data = await res.json();
      setKeywords(data.keywords);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchKeywords(); }, [fetchKeywords]);

  function toast(msg: string, isError = false) {
    if (isError) setError(msg); else setSuccess(msg);
    setTimeout(() => { setError(''); setSuccess(''); }, 3000);
  }

  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error, true); return; }
      setInput('');
      toast('Target added — historical backfill running');
      fetchKeywords();
    } finally {
      setAdding(false);
    }
  }

  async function toggleKeyword(kw: Keyword) {
    const res = await fetch(`/api/keywords/${kw.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !kw.active }),
    });
    if (res.ok) {
      setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, active: !k.active } : k));
      toast(kw.active ? 'Keyword paused' : 'Keyword resumed');
    }
  }

  async function deleteKeyword(id: string) {
    if (!confirm('Delete this target and all its matches?')) return;
    const res = await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setKeywords(prev => prev.filter(k => k.id !== id));
      toast('Target deleted');
    }
  }

  const count = keywords.length;

  return (
    <div className="fade-in">
      {(error || success) && (
        <div className="toast-container">
          {error && <div className="toast toast-error">{error}</div>}
          {success && <div className="toast toast-success" style={{ color:'var(--green)' }}>{success}</div>}
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">Keywords</h1>
      </div>

      <div className="card" style={{ marginBottom:18 }}>
        <div className="card-header">
          <div>
            <div className="card-title" style={{ fontSize:16 }}>Tracked Targets</div>
            <div className="card-subtitle" style={{ fontSize:13 }}>Add specific phrases, brand names, or competitors to monitor.</div>
          </div>
          <span className="keyword-counter" style={{ color: count >= 10 ? '#ef4444' : 'var(--accent)' }}>
            <Activity size={14} strokeWidth={2.5} />
            {count}/10
          </span>
        </div>

        <form onSubmit={addKeyword} className="input-group" style={{ marginTop: 4 }}>
          <div style={{ position:'relative', flex:1 }}>
            <Search size={16} style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
            <input
              className="input"
              style={{ paddingLeft: 40 }}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="e.g. 'Next.js 14', 'Acme Corp', 'mechanical keyboard'"
              disabled={count >= 10 || adding}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={count >= 10 || adding || !input.trim()}>
            {adding ? <span className="spinner" style={{ width:16, height:16 }} /> : <><Plus size={16} strokeWidth={2.5} /> Add Target</>}
          </button>
        </form>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:32 }}>
          <span className="spinner" style={{ width:28, height:28, borderWidth:2 }} />
        </div>
      ) : keywords.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">#</div>
            <div className="empty-state-text">No targets yet</div>
            <div className="empty-state-sub">Add your first target above to start monitoring Reddit</div>
          </div>
        </div>
      ) : (
        <div className="keyword-list">
          {keywords.map(kw => (
            <div
              key={kw.id}
              className={`keyword-item keyword-item-clickable ${!kw.active ? 'inactive' : ''}`}
              onClick={() => router.push(`/dashboard?keywordId=${kw.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/dashboard?keywordId=${kw.id}`); }}
              title="View Reddit threads for this keyword"
            >
              <div style={{ flex:1, minWidth: 0 }}>
                <div className="keyword-pill">&quot;{kw.keyword}&quot;</div>
                <div style={{ display:'flex', gap:14, marginTop:6, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ fontSize:12, color:'var(--text-muted)' }}>
                    Added {new Date(kw.createdAt).toLocaleDateString('en-GB')}
                  </span>
                  <span style={{ fontSize:12, color:'var(--text-muted)', display:'inline-flex', alignItems:'center', gap:4 }}>
                    <Activity size={12} strokeWidth={2} />
                    {kw._count.matches} matches
                  </span>
                  {!kw.active && (
                    <span className="keyword-badge badge-paused">paused</span>
                  )}
                </div>
              </div>
              <div className="actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => { e.stopPropagation(); toggleKeyword(kw); }}
                  title={kw.active ? 'Pause' : 'Resume'}
                  style={{ padding:'6px 8px' }}
                >
                  {kw.active ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={(e) => { e.stopPropagation(); deleteKeyword(kw.id); }}
                  title="Delete"
                  style={{ padding:'6px 8px' }}
                >
                  <X size={14} />
                </button>
              </div>
              <ChevronRight size={16} className="keyword-chevron" />
            </div>
          ))}
        </div>
      )}

      {count >= 10 && (
        <div style={{ marginTop:18, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.15)', borderRadius:10, padding:'14px 18px', fontSize:13, color:'#ef4444' }}>
          You&apos;ve reached the 10-target limit. Delete a target to add a new one.
        </div>
      )}
    </div>
  );
}
