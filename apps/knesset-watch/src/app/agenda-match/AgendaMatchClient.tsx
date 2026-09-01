'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DOMAINS, POLITICAL_ISSUES } from '@/lib/agendas';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** כמה תחומים המשתמש בוחר בשלב הראשון */
const DOMAIN_PICKS = 3;

type Step = 'domains' | 'issues' | 'results';

interface AgendaFlags {
  rebelVotes: number;
  contradictedOwnBill: number;
}

interface BillRef {
  billId: number;
  title: string;
  advanced: boolean;
  passed: boolean;
}

interface AgendaScore {
  issueId: string;
  label: string;
  billsInitiated: number;
  billsAdvanced: number;
  bills: BillRef[];
  supportingVotes: number;
  voteOpportunities: number;
  supportRate: number;
  pInitiative: number;
  pVoting: number;
  score: number;
  flags: AgendaFlags;
}

interface Row {
  mkId: number;
  name: string;
  faction: string | null;
  slug: string | null;
  isCoalition: boolean;
  isMinister: boolean;
  overallScore: number;
  perAgenda: AgendaScore[];
}

interface Coverage {
  issueId: string;
  label: string;
  billCount: number;
  voteCount: number;
  activeMks: number;
  source: 'classification' | 'keywords';
  belowThreshold: boolean;
}

export default function AgendaMatchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('domains');
  const [domains, setDomains] = useState<string[]>([]);
  /** issueId -> stanceId שנבחר */
  const [stances, setStances] = useState<Record<string, string>>({});

  const [rows, setRows] = useState<Row[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [totalRanked, setTotalRanked] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  /**
   * תחומים שנבחרו כבר במסך הבית מגיעים כ-?domains=a,b,c
   * ומדלגים ישר לשלב העמדות.
   */
  useEffect(() => {
    const raw = searchParams.get('domains');
    if (!raw) return;
    const valid = raw.split(',').filter(id => DOMAINS.some(d => d.id === id)).slice(0, DOMAIN_PICKS);
    if (valid.length > 0) {
      setDomains(valid);
      setStep('issues');
    }
  }, [searchParams]);

  /** האג'נדות ששייכות לתחומים שנבחרו, מקובצות לפי התחום שלהן */
  const issuesByDomain = useMemo(
    () =>
      domains
        .map(id => ({
          domain: DOMAINS.find(d => d.id === id)!,
          issues: POLITICAL_ISSUES.filter(i => i.domainId === id),
        }))
        .filter(g => g.domain && g.issues.length > 0),
    [domains],
  );

  const chosenIssueIds = Object.keys(stances);

  function toggleDomain(id: string) {
    setDomains(prev => {
      if (prev.includes(id)) return prev.filter(d => d !== id);
      if (prev.length >= DOMAIN_PICKS) return prev;
      return [...prev, id];
    });
  }

  function pickStance(issueId: string, stanceId: string) {
    setStances(prev => {
      // לחיצה שנייה על אותה עמדה מבטלת את הבחירה באג'נדה
      if (prev[issueId] === stanceId) {
        const next = { ...prev };
        delete next[issueId];
        return next;
      }
      return { ...prev, [issueId]: stanceId };
    });
  }

  async function runSearch() {
    setLoading(true);
    setError(null);
    setStep('results');

    try {
      const res = await fetch(`${BASE_PATH}/api/agenda-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: chosenIssueIds.map(issueId => ({ issueId, stanceId: stances[issueId] })),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'הבקשה נכשלה');

      setRows(json.rows ?? []);
      setCoverage(json.coverage ?? []);
      setTotalRanked(json.totalRanked ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה לא ידועה');
    } finally {
      setLoading(false);
    }
  }

  function restart() {
    setStep('domains');
    setDomains([]);
    setStances({});
    setRows([]);
    setCoverage([]);
    setError(null);
    setExpanded(null);
  }

  function handleBack() {
    if (step === 'results') return setStep('issues');
    if (step === 'issues') return setStep('domains');
    if (window.history.length > 1) router.back();
    else router.push('/');
  }

  const thinAgendas = coverage.filter(c => c.belowThreshold);

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={handleBack}
            className="text-sm font-black px-3 py-1.5 rounded border border-black/10 hover:bg-gray-50 transition-colors"
          >
            → חזרה
          </button>
          <div>
            <h1 className="text-2xl font-black leading-tight">מי עובד בשביל מה שחשוב לך</h1>
            <p className="text-xs text-gray-500 mt-0.5 font-medium">
              דירוג חברי הכנסת לפי מידת הפעילות שלהם בנושאים שתבחרי — כנסת 25
            </p>
          </div>
        </div>

        {/* Progress */}
        <ol className="flex items-center gap-2 mb-8 text-xs font-black">
          {(['domains', 'issues', 'results'] as Step[]).map((s, i) => {
            const labels = { domains: 'תחומים', issues: 'עמדות', results: 'תוצאות' };
            const order: Step[] = ['domains', 'issues', 'results'];
            const done = order.indexOf(step) > i;
            const active = step === s;
            return (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full border ${
                    active
                      ? 'bg-black text-white border-black'
                      : done
                        ? 'bg-gray-100 text-gray-700 border-black/10'
                        : 'bg-white text-gray-400 border-black/10'
                  }`}
                >
                  {i + 1}. {labels[s]}
                </span>
                {i < 2 && <span className="text-gray-300">—</span>}
              </li>
            );
          })}
        </ol>

        {/* ── Step 1: domains ──
            תחום = טורקיז. הגוון הזה חוזר בכל מקום שבו מוצג תחום,
            כדי שההיררכיה תחום ← אג'נדה תיקרא מיד. */}
        {step === 'domains' && (
          <div>
            <h2 className="text-lg font-black mb-1">בחרי עד שלושה תחומים</h2>
            <p className="text-sm text-gray-500 mb-5 font-medium">
              נבחרו {domains.length} מתוך {DOMAIN_PICKS}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {DOMAINS.map(d => {
                const selected = domains.includes(d.id);
                const count = POLITICAL_ISSUES.filter(i => i.domainId === d.id).length;
                const disabled = (domains.length >= DOMAIN_PICKS && !selected) || count === 0;
                return (
                  <button
                    key={d.id}
                    onClick={() => toggleDomain(d.id)}
                    disabled={disabled}
                    className={`text-right rounded-xl border-2 p-4 transition-colors ${
                      selected
                        ? 'border-teal-600 bg-teal-50'
                        : disabled
                          ? 'border-black/8 opacity-40 cursor-not-allowed'
                          : 'border-black/8 bg-white hover:border-teal-300 hover:bg-teal-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className={`text-base font-black leading-snug ${selected ? 'text-teal-900' : ''}`}>
                        {d.label}
                      </h3>
                      {selected && <span className="text-sm font-black text-teal-700">✓</span>}
                    </div>
                    <p className={`text-xs mt-1 font-medium ${selected ? 'text-teal-700' : 'text-gray-500'}`}>
                      {count > 0 ? `${count} אג'נדות` : 'אין אג\'נדות מוגדרות'}
                    </p>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setStep('issues')}
              disabled={domains.length === 0}
              className="mt-6 px-5 py-2.5 rounded-lg bg-black text-white font-black text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
            >
              המשך לבחירת עמדות
            </button>
          </div>
        )}

        {/* ── Step 2: issues grouped under their domain ──
            כותרת התחום בטורקיז, כרטיסי האג'נדה באינדיגו. */}
        {step === 'issues' && (
          <div>
            <h2 className="text-lg font-black mb-1">מה העמדה שלך בכל נושא?</h2>
            <p className="text-sm text-gray-500 mb-5 font-medium">
              אפשר לדלג על נושא שלא מעניין אותך. נבחרו {chosenIssueIds.length} נושאים.
            </p>

            <div className="flex flex-col gap-7">
              {issuesByDomain.map(({ domain, issues }) => (
                <section key={domain.id}>
                  {/* כותרת התחום — הגוון הטורקיז מהשלב הקודם */}
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-teal-600">
                    <span className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                      תחום
                    </span>
                    <h3 className="text-base font-black text-teal-900">{domain.label}</h3>
                    <span className="text-xs text-gray-400 font-medium">
                      {issues.length} אג&apos;נדות
                    </span>
                  </div>

                  <div className="flex flex-col gap-3">
                    {issues.map(issue => {
                      const chosen = stances[issue.id];
                      return (
                        <div
                          key={issue.id}
                          className={`rounded-xl border-r-4 border border-black/8 p-4 transition-colors ${
                            chosen ? 'border-r-indigo-600 bg-indigo-50/50' : 'border-r-indigo-200'
                          }`}
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">
                              אג&apos;נדה
                            </span>
                            <h4 className="text-base font-black">{issue.label}</h4>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 mb-3 font-medium leading-relaxed">
                            {issue.description}
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            {issue.stances.map(stance => {
                              const on = chosen === stance.id;
                              return (
                                <button
                                  key={stance.id}
                                  onClick={() => pickStance(issue.id, stance.id)}
                                  className={`flex-1 text-right text-xs font-black leading-relaxed rounded-lg border px-3 py-2.5 transition-colors ${
                                    on
                                      ? 'border-indigo-600 bg-indigo-600 text-white'
                                      : 'border-black/10 bg-white hover:border-indigo-300 hover:bg-indigo-50/50'
                                  }`}
                                >
                                  {stance.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <button
              onClick={runSearch}
              disabled={chosenIssueIds.length === 0}
              className="mt-7 px-5 py-2.5 rounded-lg bg-black text-white font-black text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
            >
              הצג את חברי הכנסת
            </button>
          </div>
        )}

        {/* ── Step 3: results ── */}
        {step === 'results' && (
          <div>
            {loading && (
              <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">
                מחשב מעורבות...
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5">
                <p className="font-black text-red-700 text-sm">{error}</p>
                <button onClick={restart} className="mt-3 text-xs font-black underline text-red-700">
                  להתחיל מחדש
                </button>
              </div>
            )}

            {!loading && !error && rows.length === 0 && (
              <div className="rounded-xl border border-black/8 bg-gray-50 p-6">
                <p className="font-black text-sm">לא נמצאו חברי כנסת פעילים בנושאים שנבחרו.</p>
                <button onClick={restart} className="mt-3 text-xs font-black underline">
                  לבחור נושאים אחרים
                </button>
              </div>
            )}

            {!loading && !error && rows.length > 0 && (
              <>
                <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
                  <h2 className="text-lg font-black">הפעילים ביותר בנושאים שלך</h2>
                  <span className="text-xs text-gray-500 font-medium">
                    {totalRanked} חברי כנסת בדירוג
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-5 font-medium leading-relaxed">
                  הציון משקלל 60% יוזמה חקיקתית ו-40% תמיכה בהצבעות, שניהם כאחוזון ביחס לשאר
                  הפעילים באותו נושא. המדד מודד <strong>מידת פעילות</strong>, לא הסכמה מלאה איתך.
                </p>

                {thinAgendas.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-5">
                    <p className="text-xs font-black text-amber-900 leading-relaxed">
                      ⚠ מעט חומר בנושאים: {thinAgendas.map(a => a.label).join(', ')}. הדירוג שם
                      מבוסס על מספר קטן של חוקים והצבעות, ולכן פחות אמין.
                    </p>
                  </div>
                )}

                <ol className="flex flex-col gap-3">
                  {rows.map((row, idx) => {
                    const open = expanded === row.mkId;
                    const rebels = row.perAgenda.reduce((s, a) => s + a.flags.rebelVotes, 0);
                    const contradictions = row.perAgenda.reduce(
                      (s, a) => s + a.flags.contradictedOwnBill,
                      0,
                    );
                    return (
                      <li key={row.mkId} className="rounded-xl border border-black/8 overflow-hidden">
                        <button
                          onClick={() => setExpanded(open ? null : row.mkId)}
                          className="w-full text-right p-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-black text-gray-400 w-6 shrink-0 tabular-nums">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-base font-black">{row.name}</h3>
                                {row.isMinister && (
                                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                                    שר/ה
                                  </span>
                                )}
                                {rebels > 0 && (
                                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                                    מרד סיעתי {rebels}
                                  </span>
                                )}
                                {contradictions > 0 && (
                                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-orange-100 text-orange-800">
                                    סתירה {contradictions}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 font-medium mt-0.5">
                                {row.faction ?? 'ללא סיעה'} · {row.isCoalition ? 'קואליציה' : 'אופוזיציה'}
                              </p>
                            </div>
                            <div className="shrink-0 text-left">
                              <div className="text-xl font-black tabular-nums">{row.overallScore}</div>
                              <div className="text-[10px] text-gray-400 font-black">מתוך 100</div>
                            </div>
                          </div>

                          <div className="mt-3 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className="h-full bg-black rounded-full"
                              style={{ width: `${Math.min(100, row.overallScore)}%` }}
                            />
                          </div>
                        </button>

                        {open && (
                          <div className="border-t border-black/8 bg-gray-50 p-4">
                            {row.isMinister && (
                              <p className="text-xs text-gray-600 font-medium mb-3 leading-relaxed">
                                שרים אינם מגישים הצעות חוק פרטיות ונוכחים פחות בהצבעות, ולכן הציון
                                שלהם נמוך מטבעו ואינו משקף את עבודתם.
                              </p>
                            )}

                            <div className="flex flex-col gap-4">
                              {row.perAgenda.map(a => (
                                <div
                                  key={a.issueId}
                                  className="border-r-4 border-indigo-300 pr-3 bg-white rounded-lg py-3 pl-3"
                                >
                                  <div className="flex items-baseline justify-between gap-2">
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">
                                        אג&apos;נדה
                                      </span>
                                      <h4 className="text-sm font-black">{a.label}</h4>
                                    </div>
                                    <span className="text-sm font-black tabular-nums">{a.score}</span>
                                  </div>

                                  <p className="text-xs text-gray-600 font-medium mt-1 leading-relaxed">
                                    יזם {a.billsInitiated} הצעות חוק
                                    {a.billsAdvanced > 0 && ` (${a.billsAdvanced} התקדמו)`}
                                    {' · '}
                                    תמך ב-{a.supportingVotes} מתוך {a.voteOpportunities} הצבעות
                                    {' · '}
                                    אחוזונים {a.pInitiative} / {a.pVoting}
                                  </p>

                                  {a.bills.length > 0 && (
                                    <ul className="mt-2.5 flex flex-col gap-1.5">
                                      {a.bills.map(b => (
                                        <li key={b.billId} className="flex items-start gap-2">
                                          <Link
                                            href={`/bill/${b.billId}`}
                                            prefetch={false}
                                            className="text-xs font-medium leading-relaxed text-indigo-700 hover:underline flex-1"
                                          >
                                            {b.title}
                                          </Link>
                                          {b.passed ? (
                                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 shrink-0">
                                              עבר
                                            </span>
                                          ) : b.advanced ? (
                                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 shrink-0">
                                              התקדם
                                            </span>
                                          ) : null}
                                        </li>
                                      ))}
                                      {a.billsInitiated > a.bills.length && (
                                        <li className="text-[11px] text-gray-400 font-medium">
                                          ועוד {a.billsInitiated - a.bills.length} הצעות
                                        </li>
                                      )}
                                    </ul>
                                  )}
                                </div>
                              ))}
                            </div>

                            {row.slug && (
                              <Link
                                href={`/mk/${row.slug}`}
                                prefetch={false}
                                className="inline-block mt-3 text-xs font-black underline"
                              >
                                לעמוד חבר הכנסת ←
                              </Link>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>

                <button
                  onClick={restart}
                  className="mt-6 px-5 py-2.5 rounded-lg border border-black/10 font-black text-sm hover:bg-gray-50 transition-colors"
                >
                  להתחיל מחדש
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
