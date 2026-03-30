'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();

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
        setError(data.error || 'Incorrect password');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4 font-serif">
      <div className="w-full max-w-xs space-y-12 text-center">
        <header className="space-y-2">
          <h1 className="text-4xl font-black tracking-tighter lowercase">{title}</h1>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1 text-left">
            <input
              type="password"
              placeholder="Enter Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border-b border-black/10 py-3 text-center text-sm lowercase outline-none focus:border-black transition-colors bg-transparent text-black"
              required
              autoFocus
            />
          </div>

          {error && (
            <p className="text-[10px] lowercase tracking-tight text-red-500 font-sans italic">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all
              ${loading 
                ? 'opacity-50 cursor-not-allowed' 
                : 'bg-black text-white hover:bg-black/80'
              }`}
          >
            {loading ? 'Verifying...' : 'Authorize'}
          </button>
        </form>

      </div>
    </div>
  );
}
