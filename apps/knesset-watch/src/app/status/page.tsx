'use client';
import { useEffect, useState } from 'react';

interface StatusData {
  plenary: {
    sessions: { total: number; scraped: number; reparsed: number };
    turns: { total: number; mk_matched: number; embedded: number };
  };
  committee: {
    turns: { total: number; embedded: number };
  };
  timestamp: string;
}

function Bar({ a, b }: { a: number; b: number }) {
  const pct = b ? Math.min((a / b) * 100, 100) : 0;
  return (
    <div className="h-1.5 bg-gray-200 rounded mt-1">
      <div className="h-1.5 bg-blue-500 rounded" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Row({ label, a, b, noBar }: { label: string; a: number; b: number; noBar?: boolean }) {
  const pct = b ? ((a / b) * 100).toFixed(1) : '—';
  return (
    <div className="mb-3">
      <div className="flex justify-between text-sm">
        <span className="text-gray-700">{label}</span>
        <span className="tabular-nums">{a.toLocaleString()} / {b.toLocaleString()} ({pct}%)</span>
      </div>
      {!noBar && <Bar a={a} b={b} />}
    </div>
  );
}

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState('');

  const refresh = () =>
    fetch('/api/status')
      .then(r => {
        if (r.status === 401) throw new Error('Not authenticated — log in first');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: StatusData) => {
        setData(d);
        setError('');
        setLastUpdated(new Date().toLocaleTimeString('he-IL'));
      })
      .catch(e => setError(e.message));

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!data) return <div className="p-8 text-gray-500">Loading...</div>;

  const { plenary, committee } = data;

  return (
    <div className="p-8 max-w-xl mx-auto font-mono text-sm" dir="ltr">
      <h1 className="text-xl font-bold mb-6">Job Status</h1>

      <section className="mb-6">
        <h2 className="font-semibold mb-3 text-gray-900">Plenary Sessions</h2>
        <Row label="Scraped" a={plenary.sessions.scraped} b={plenary.sessions.total} />
        <Row label="Reparsed" a={plenary.sessions.reparsed} b={plenary.sessions.total} />
      </section>

      <section className="mb-6">
        <h2 className="font-semibold mb-3 text-gray-900">Plenary Turns</h2>
        <Row label="Total" a={plenary.turns.total} b={plenary.sessions.total} noBar />
        <Row label="MK-matched" a={plenary.turns.mk_matched} b={plenary.turns.total} />
        <Row label="Embedded" a={plenary.turns.embedded} b={plenary.turns.total} />
      </section>

      <section className="mb-6">
        <h2 className="font-semibold mb-3 text-gray-900">Committee Turns</h2>
        <Row label="Embedded" a={committee.turns.embedded} b={committee.turns.total} />
      </section>

      <p className="text-gray-400 mt-8 text-xs">
        Last updated: {lastUpdated} · auto-refreshes every 30s
      </p>
    </div>
  );
}
