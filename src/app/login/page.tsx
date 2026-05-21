'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (params.get('registered')) setSuccess('Account created! Please sign in.');
  }, [params]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const result = await signIn('credentials', {
      email: form.email, password: form.password, redirect: false,
    });
    setLoading(false);
    if (result?.error) { setError('Invalid email or password'); return; }
    router.push('/dashboard');
  }

  async function handleGoogle() {
    await signIn('google', { callbackUrl: '/dashboard' });
  }

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <div className="auth-logo">
          <div className="auth-icon">🎯</div>
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to your Reddit Monitor</p>
        </div>
        {success && (
          <div style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.2)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--green)', marginBottom:16 }}>
            {success}
          </div>
        )}
        <form className="auth-form" onSubmit={handleSubmit}>
          {error && (
            <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#ef4444' }}>
              {error}
            </div>
          )}
          <div>
            <label className="form-label">Email address</label>
            <input className="input" type="email" placeholder="you@example.com" required
              value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Password</label>
            <input className="input" type="password" placeholder="Your password" required
              value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width:'100%', justifyContent:'center' }}>
            {loading ? <span className="spinner" /> : 'Sign In'}
          </button>
        </form>
        <div className="auth-divider"><span>or</span></div>
        <button className="btn btn-secondary" onClick={handleGoogle} style={{ width:'100%', justifyContent:'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Continue with Google
        </button>
        <p style={{ textAlign:'center', fontSize:13, color:'var(--text-muted)', marginTop:20 }}>
          No account?{' '}
          <Link href="/register" style={{ color:'var(--accent)', textDecoration:'none', fontWeight:600 }}>Create one</Link>
        </p>
      </div>
    </div>
  );
}
