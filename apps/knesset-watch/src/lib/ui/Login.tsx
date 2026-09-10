'use client';

import { useState } from 'react';

interface LoginProps {
  title?: string;
  endpoint?: string;
  onSuccessRedirect?: string;
  cookieName?: string;
}

export function LoginForm({
  title = 'Minimal DB',
  endpoint = '/api/auth',
  onSuccessRedirect = '/',
  cookieName = 'auth_token'
}: LoginProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const fullUrl = new URL(endpoint, window.location.origin).href;
      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok) {
        // SET COOKIE MANUALLY ON CLIENT TO ENSURE IT PERSISTS ACROSS PROXY
        if (data.token) {
          const maxAge = 60 * 60 * 24 * 7; // 7 days
          // Use root path for the cookie to ensure it's visible to the app
          document.cookie = `${cookieName}=${data.token}; Max-Age=${maxAge}; path=/; SameSite=Lax; Secure`;
        }
        // HARD REDIRECT: Bypasses Next.js router state issues
        window.location.href = onSuccessRedirect;
      } else {
        setError(
          res.status === 429
            ? 'יותר מדי ניסיונות. נסי שוב בעוד דקה.'
            : 'הסיסמה שגויה. בדקי ונסי שוב.'
        );
      }
    } catch {
      setError('אין חיבור לשרת. בדקי את החיבור ונסי שוב.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-4" dir="rtl">
      <div className="w-full max-w-xs">
        <h1 className="text-page mb-2 text-center">{title}</h1>
        <p className="text-meta text-mute mb-8 text-center">
          האתר סגור בסיסמה בזמן הפיתוח
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="site-password" className="text-label font-medium">
              סיסמה
            </label>
            <input
              id="site-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-ui text-ink transition-colors focus:border-accent"
              required
              autoFocus
              aria-describedby={error ? 'password-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
          </div>

          {error && (
            <p id="password-error" role="alert" className="text-meta text-fail">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full rounded-control bg-accent px-4 py-3 text-ui font-medium text-white transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'בודק…' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}
