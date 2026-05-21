'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Registration failed'); return; }
      router.push('/login?registered=1');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <div className="auth-logo">
          <div className="auth-icon">🎯</div>
          <h1 className="auth-title">Create account</h1>
          <p className="auth-subtitle">Start monitoring Reddit in minutes</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {error && (
            <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#ef4444' }}>
              {error}
            </div>
          )}
          <div>
            <label className="form-label">Full name</label>
            <input className="input" type="text" placeholder="John Doe" required minLength={2}
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Email address</label>
            <input className="input" type="email" placeholder="you@example.com" required
              value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Password</label>
            <input className="input" type="password" placeholder="Min 8 characters" required minLength={8}
              value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width:'100%', justifyContent:'center', marginTop:4 }}>
            {loading ? <span className="spinner" /> : 'Create Account'}
          </button>
        </form>
        <p style={{ textAlign:'center', fontSize:13, color:'var(--text-muted)', marginTop:20 }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color:'var(--accent)', textDecoration:'none', fontWeight:600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
