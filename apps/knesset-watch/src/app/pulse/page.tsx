'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/**
 * החוקים האחרונים שהתקבלו.
 *
 * הגרסה הקודמת הציגה נקודה אדומה מהבהבת עם הכיתוב "Live: דופק הכנסת",
 * בזמן שהחוק החדש ביותר היה בן חצי שנה — האלמנט המטעה ביותר באתר.
 * לצדו הופיע מספר בגופן של 120 פיקסלים תחת הכותרת "חוקים שעברו סופית",
 * שהיה תמיד 8 כי הוא נספר אחרי LIMIT 8.
 *
 * כאן מוצג המספר האמיתי, ולצדו התאריך בפועל של הפריט האחרון — כדי
 * שהטריות תהיה נתון גלוי ולא הבטחה.
 */

interface PulseBill {
  id: number;
  title: string;
  date: string;
}

interface PulseData {
  total: number;
  bills: PulseBill[];
  newest: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function monthsAgo(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24 * 30));
}

export default function PulsePage() {
  const [data, setData] = useState<PulseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPulse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pulse');
      if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בטעינת הנתונים');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPulse(); }, [fetchPulse]);

  const staleMonths = monthsAgo(data?.newest ?? null);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12" dir="rtl">
      <header className="mb-8">
        <h1 className="text-page mb-2">חקיקה אחרונה</h1>
        <p className="text-body font-content text-mute max-w-2xl">
          הצעות החוק האחרונות שהתקבלו בכנסת ה-25 והפכו לחוק.
        </p>
      </header>

      {loading && (
        <>
          <span className="sr-only" role="status">טוען נתונים</span>
          <div className="animate-pulse space-y-4" aria-hidden="true">
            <div className="h-28 rounded-card bg-surface-2" />
            <div className="h-56 rounded-card bg-surface-2" />
          </div>
        </>
      )}

      {error && (
        <div role="alert" className="rounded-card border border-fail/30 bg-fail-wash px-4 py-3">
          <p className="text-ui text-ink mb-1">{error}</p>
          <button onClick={fetchPulse} className="text-ui font-medium text-accent underline">
            נסי שוב
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="mb-8 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
            <div className="bg-surface px-5 py-4">
              <div className="text-meta text-mute mb-1">חוקים שהתקבלו בכנסת ה-25</div>
              <div className="text-page font-medium text-pass" data-numeric>
                {data.total.toLocaleString()}
              </div>
            </div>
            <div className="bg-surface px-5 py-4">
              <div className="text-meta text-mute mb-1">החוק האחרון שהתקבל</div>
              <div className="text-section font-medium" data-numeric>
                {formatDate(data.newest) || '—'}
              </div>
              {staleMonths !== null && staleMonths >= 2 && (
                <p className="text-meta text-mute mt-1">
                  לפני כ-{staleMonths} חודשים — זה עדכון הנתונים האחרון שיש לנו
                </p>
              )}
            </div>
          </div>

          {data.bills.length === 0 ? (
            <p className="rounded-card border border-line bg-surface px-4 py-3 text-ui text-mute">
              לא נמצאו חוקים שהתקבלו בטווח הזה.
            </p>
          ) : (
            <section>
              <h2 className="text-section mb-4">שמונת האחרונים</h2>
              <ol className="flex flex-col gap-1.5">
                {data.bills.map(b => (
                  <li key={b.id}>
                    <Link
                      href={`/bill/${b.id}`}
                      className="flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 transition-colors hover:border-accent"
                    >
                      <span className="shrink-0 rounded-control bg-pass-wash px-2 py-0.5 text-meta font-medium text-pass">
                        עבר
                      </span>
                      <span className="min-w-0 flex-1 text-ui font-content text-ink leading-snug">
                        {b.title}
                      </span>
                      <span className="shrink-0 text-meta text-mute" data-numeric>
                        {b.date.slice(0, 10)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>

              <Link
                href="/bills?passedOnly=true"
                className="mt-4 inline-block text-ui font-medium text-accent hover:underline"
              >
                כל החוקים שהתקבלו ←
              </Link>
            </section>
          )}
        </>
      )}
    </div>
  );
}
