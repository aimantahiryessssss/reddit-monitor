'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, Mail, Clock } from 'lucide-react';

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
];

const TIMES = Array.from({ length: 24 }, (_, i) => {
  const h12 = i === 0 ? 12 : i > 12 ? i - 12 : i;
  const period = i < 12 ? 'AM' : 'PM';
  const value = `${String(i).padStart(2, '0')}:00`;
  return { value, label: `${h12}:00 ${period}` };
});

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const fetchSettings = useCallback(async () => {
    const res = await fetch('/api/settings');
    if (res.ok) setSettings((await res.json()).user);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function saveAlerts() {
    setSaving(true);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailAlerts: settings.emailAlerts,
        instantAlerts: settings.instantAlerts,
      }),
    });
    setSaving(false);
    if (res.ok) showToast('Alert preferences saved');
  }

  async function saveDigest() {
    setSaving(true);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        digestEnabled: settings.digestEnabled,
        digestTime: settings.digestTime,
        timezone: settings.timezone,
      }),
    });
    setSaving(false);
    if (res.ok) showToast('Digest schedule updated');
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  );

  return (
    <div className="fade-in">
      {toast && (
        <div className="toast-container">
          <div className="toast toast-success" style={{ color: 'var(--green)' }}>{toast}</div>
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* Alert Preferences */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Bell size={18} fill="currentColor" style={{ color: 'var(--accent)' }} />
          <div className="card-title" style={{ fontSize: 16 }}>Alert Preferences</div>
        </div>
        <div className="card-subtitle" style={{ marginBottom: 20 }}>Configure how and when you want to be notified about matches.</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Instant Web Alerts</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Show matches in the dashboard immediately as they happen.</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings?.instantAlerts ?? true}
                onChange={e => setSettings((s: any) => ({ ...s, instantAlerts: e.target.checked }))} />
              <span className="toggle-slider" />
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                <Mail size={14} /> Email Notifications
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Send alerts to your inbox.</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings?.emailAlerts ?? false}
                onChange={e => setSettings((s: any) => ({ ...s, emailAlerts: e.target.checked }))} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <button className="btn btn-primary" onClick={saveAlerts} disabled={saving}>
          {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Save Preferences'}
        </button>
      </div>

      {/* Daily Digest */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Clock size={18} fill="currentColor" style={{ color: 'var(--accent)' }} />
          <div className="card-title" style={{ fontSize: 16 }}>Daily Digest Schedule</div>
        </div>
        <div className="card-subtitle" style={{ marginBottom: 20 }}>Set when you want to receive your summarized daily report.</div>

        <div className="grid-2" style={{ marginBottom: 20 }}>
          <div>
            <label className="form-label">Delivery Time</label>
            <select className="input" value={settings?.digestTime || '09:00'}
              onChange={e => setSettings((s: any) => ({ ...s, digestTime: e.target.value }))}>
              {TIMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Timezone</label>
            <select className="input" value={settings?.timezone || 'UTC'}
              onChange={e => setSettings((s: any) => ({ ...s, timezone: e.target.value }))}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>

        <button className="btn btn-secondary" onClick={saveDigest} disabled={saving}>
          {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Update Schedule'}
        </button>
      </div>
    </div>
  );
}
