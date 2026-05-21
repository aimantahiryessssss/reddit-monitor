'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Bell, BellOff, BellRing } from 'lucide-react';

const LS_ENABLED = 'kw-alerts-enabled';
const LS_LAST_SEEN = 'kw-alerts-last-seen';
const POLL_MS = 60_000;

type AlertState = 'off' | 'pending' | 'on' | 'denied' | 'unsupported';

function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export default function DesktopAlerts() {
  const { status } = useSession();
  const [state, setState] = useState<AlertState>('off');
  const lastSeenRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize from localStorage + current permission
  useEffect(() => {
    if (!notificationsSupported()) {
      setState('unsupported');
      return;
    }
    const stored = localStorage.getItem(LS_ENABLED) === '1';
    const perm = Notification.permission;
    if (perm === 'denied') setState('denied');
    else if (stored && perm === 'granted') setState('on');
    else setState('off');

    const lastSeen = Number(localStorage.getItem(LS_LAST_SEEN) || 0);
    lastSeenRef.current = lastSeen || Math.floor(Date.now() / 1000);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/matches?limit=20', { cache: 'no-store' });
      if (!res.ok) return;
      const { matches } = await res.json();
      if (!Array.isArray(matches) || matches.length === 0) return;

      const lastSeen = lastSeenRef.current;
      // Reddit createdUtc is seconds since epoch (sometimes returned as ISO; handle both)
      const fresh = matches.filter((m: any) => {
        const created = m.redditPost?.createdUtc;
        const ts = typeof created === 'number'
          ? created
          : Math.floor(new Date(created).getTime() / 1000);
        return ts > lastSeen;
      });

      if (fresh.length === 0) return;

      // Fire up to 5 notifications per poll to avoid notification spam
      const toShow = fresh.slice(0, 5);
      for (const m of toShow) {
        const title = `🔥 ${m.keyword?.keyword ?? 'New match'}`;
        const post = m.redditPost;
        const bodyText = (post?.title || post?.content || '').slice(0, 140);
        const body = `${bodyText}\nr/${post?.subreddit ?? '?'}`;
        try {
          const n = new Notification(title, {
            body,
            tag: m.id,
            icon: '/favicon.ico',
          });
          n.onclick = () => {
            window.focus();
            if (post?.url) window.open(post.url, '_blank', 'noopener');
            n.close();
          };
        } catch {
          // Some browsers throw if called too soon — ignore
        }
      }
      if (fresh.length > toShow.length) {
        try {
          new Notification(`+${fresh.length - toShow.length} more new matches`, {
            body: 'Open the dashboard to see them all.',
            tag: 'kw-alerts-overflow',
          });
        } catch { /* noop */ }
      }

      // Advance last-seen to the newest createdUtc we saw
      const newestTs = matches.reduce((max: number, m: any) => {
        const created = m.redditPost?.createdUtc;
        const ts = typeof created === 'number'
          ? created
          : Math.floor(new Date(created).getTime() / 1000);
        return ts > max ? ts : max;
      }, lastSeen);
      lastSeenRef.current = newestTs;
      localStorage.setItem(LS_LAST_SEEN, String(newestTs));
    } catch {
      // network blip — ignore, next tick will retry
    }
  }, []);

  // Start/stop polling based on state + auth
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (state !== 'on' || status !== 'authenticated') return;

    // Run once immediately so the user sees activity, then on interval
    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state, status, poll]);

  async function enable() {
    if (!notificationsSupported()) return;
    setState('pending');
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        localStorage.setItem(LS_ENABLED, '1');
        // Seed last-seen to "now" so we don't get a flood for historical matches
        const now = Math.floor(Date.now() / 1000);
        lastSeenRef.current = now;
        localStorage.setItem(LS_LAST_SEEN, String(now));
        setState('on');
        // Confirmation toast notification
        try {
          new Notification('Desktop alerts on', {
            body: 'You\'ll be notified when new Reddit threads match your keywords.',
            tag: 'kw-alerts-enabled',
          });
        } catch { /* noop */ }
      } else if (perm === 'denied') {
        setState('denied');
      } else {
        setState('off');
      }
    } catch {
      setState('off');
    }
  }

  function disable() {
    localStorage.setItem(LS_ENABLED, '0');
    setState('off');
  }

  if (state === 'unsupported') return null;
  if (status !== 'authenticated') return null;

  if (state === 'denied') {
    return (
      <button
        className="topbar-logout"
        title="Notifications blocked — enable them in your browser settings"
        style={{ color: 'var(--text-muted)' }}
        onClick={() =>
          alert(
            'Browser notifications are blocked for this site.\n\n' +
            'Click the lock icon in your address bar → Site settings → Notifications → Allow, then reload.'
          )
        }
      >
        <BellOff size={14} />
      </button>
    );
  }

  if (state === 'on') {
    return (
      <button
        className="topbar-logout"
        title="Desktop alerts on — click to turn off"
        style={{ color: 'var(--accent)' }}
        onClick={disable}
      >
        <BellRing size={14} />
      </button>
    );
  }

  return (
    <button
      className="topbar-logout"
      title="Turn on desktop alerts for new matches"
      onClick={enable}
      disabled={state === 'pending'}
    >
      <Bell size={14} />
    </button>
  );
}
