'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { billStageLabel } from '@/lib/bill-stage';

/**
 * מעקב חקיקה — כמה הצעות חוק ח"כ יזם, וכמה מהן עברו.
 *
 * קודם עמדה כאן רשימה קשיחה של חמישה ח"כים מתוך 150, ושניים מהם —
 * נתניהו וסמוטריץ' — יזמו אפס הצעות חוק. סמוטריץ' היה ברירת המחדל,
 * ולכן העמוד נפתח ריק. בנוסף הוצגה עמודת "עדכון אחרון" שהריצה
 * new Date("") על שדה שה-API החזיר תמיד ריק, וכל שורה הראתה
 * "Invalid Date".
 */

interface Person {
  Id: number;
  FirstName: string;
  LastName: string;
  FactionName: string | null;
}

interface Bill {
  id: number;
  name: string;
  isPassed: boolean;
  statusId: number | null;
  summary: string | null;
  committee: string | null;
}

interface TrackRecordData {
  personId: number;
  stats: { proposed: number; passed: number; conversionRate: string };
  bills: Bill[];
}

export default function TrackRecordPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedMk, setSelectedMk] = useState<number | null>(null);
  const [data, setData] = useState<TrackRecordData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // כל 150 הח"כים, ולא חמישה קבועים
  useEffect(() => {
    fetch('/api/persons')
      .then(r => r.json())
      .then((j: { value?: Person[] }) => {
        const list = (j.value ?? []).slice().sort((a, b) =>
          `${a.LastName} ${a.FirstName}`.localeCompare(`${b.LastName} ${b.FirstName}`, 'he'),
        );
        setPeople(list);
        if (list.length > 0) setSelectedMk(list[0].Id);
      })
      .catch(() => setError('לא הצלחנו לטעון את רשימת חברי הכנסת.'));
  }, []);

  const fetchTrackRecord = useCallback(async (mkId: number) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/track-record?personId=${mkId}`);
      if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בטעינת הנתונים');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedMk !== null) fetchTrackRecord(selectedMk);
  }, [selectedMk, fetchTrackRecord]);

  const selectedName = useMemo(() => {
    const p = people.find(x => x.Id === selectedMk);
    return p ? `${p.FirstName} ${p.LastName}` : '';
  }, [people, selectedMk]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12" dir="rtl">
      <header className="mb-8">
        <h1 className="text-page mb-2">מעקב חקיקה</h1>
        <p className="text-body font-content text-mute max-w-2xl">
          כמה הצעות חוק יזם כל חבר כנסת בכנסת ה-25, וכמה מהן הגיעו לספר החוקים.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mk-select" className="text-label font-medium">
            חבר או חברת כנסת
          </label>
          <select
            id="mk-select"
            value={selectedMk ?? ''}
            onChange={e => setSelectedMk(Number(e.target.value))}
            disabled={people.length === 0}
            className="min-w-64 rounded-control border border-line bg-surface px-3 py-2.5 text-ui text-ink"
          >
            {people.length === 0 && <option value="">טוען…</option>}
            {people.map(p => (
              <option key={p.Id} value={p.Id}>
                {p.LastName} {p.FirstName}
                {p.FactionName ? ` — ${p.FactionName}` : ''}
              </option>
            ))}
          </select>
        </div>
        {people.length > 0 && (
          <span className="text-meta text-mute pb-3" data-numeric>
            {people.length} חברי כנסת
          </span>
        )}
      </div>

      {loading && (
        <>
          <span className="sr-only" role="status">טוען נתונים</span>
          <div className="animate-pulse space-y-6" aria-hidden="true">
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-card bg-surface-2" />)}
            </div>
            <div className="h-64 rounded-card bg-surface-2" />
          </div>
        </>
      )}

      {error && (
        <div role="alert" className="mb-8 rounded-card border border-fail/30 bg-fail-wash px-4 py-3">
          <p className="text-ui text-ink mb-1">{error}</p>
          {selectedMk !== null && (
            <button
              onClick={() => fetchTrackRecord(selectedMk)}
              className="text-ui font-medium text-accent underline"
            >
              נסי שוב
            </button>
          )}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="mb-8 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
            <div className="bg-surface px-5 py-4">
              <div className="text-meta text-mute mb-1">הצעות חוק שיזם</div>
              <div className="text-page font-medium" data-numeric>{data.stats.proposed}</div>
            </div>
            <div className="bg-surface px-5 py-4">
              <div className="text-meta text-mute mb-1">מהן הפכו לחוק</div>
              <div className="text-page font-medium text-pass" data-numeric>{data.stats.passed}</div>
            </div>
            <div className="bg-surface px-5 py-4">
              <div className="text-meta text-mute mb-1">שיעור המעבר</div>
              <div className="text-page font-medium" data-numeric>{data.stats.conversionRate}%</div>
            </div>
          </div>

          {data.bills.length === 0 ? (
            /*
              מצב ריק שמסביר, במקום טבלה ריקה. 22 ח"כים לא יזמו ולו הצעה
              אחת, וכולם שרים — כלומר זו תשובה, לא תקלה.
            */
            <div className="rounded-card border border-line bg-surface p-6">
              <h2 className="text-section mb-2">אין הצעות חוק ביוזמת {selectedName}</h2>
              <p className="text-body font-content text-ink-2 mb-3">
                שרים מקדמים חקיקה דרך המשרד שלהם, כהצעת חוק ממשלתית, ואינם רשומים
                בה כיוזמים. לכן 22 חברי כנסת אינם מופיעים כאן — וכולם שרים.
              </p>
              <Link
                href="/did-you-know#ministers"
                className="text-ui font-medium text-accent hover:underline"
              >
                הידעת? למה שרים כמעט לא מופיעים ←
              </Link>
            </div>
          ) : (
            <section>
              <h2 className="text-section mb-4">פירוט הצעות החוק</h2>
              <div className="flex flex-col gap-1.5">
                {data.bills.map(bill => {
                  const stage = billStageLabel(bill.statusId);
                  return (
                    <Link
                      key={bill.id}
                      href={`/bill/${bill.id}`}
                      className="rounded-card border border-line bg-surface px-4 py-3 transition-colors hover:border-accent"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`shrink-0 rounded-control px-2 py-0.5 text-meta font-medium ${
                            stage.tone === 'passed'
                              ? 'bg-pass-wash text-pass'
                              : stage.tone === 'stopped'
                                ? 'bg-fail-wash text-fail'
                                : stage.tone === 'advanced'
                                  ? 'bg-accent-wash text-accent-ink'
                                  : 'bg-surface-2 text-mute'
                          }`}
                        >
                          {stage.label}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="text-ui font-content text-ink leading-snug">{bill.name}</div>
                          {bill.summary && (
                            <p className="text-meta text-mute mt-1 line-clamp-2 font-content">
                              {bill.summary}
                            </p>
                          )}
                          {bill.committee && (
                            <p className="text-meta text-mute mt-1">{bill.committee}</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
