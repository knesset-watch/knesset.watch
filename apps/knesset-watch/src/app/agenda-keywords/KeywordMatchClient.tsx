'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CLUSTER_TOPICS, clustersOfTopic, getCluster, CLUSTER_STATS } from '@/lib/axis-clusters';
import { MkAvatar, MkBackground } from '@/components/MkIdentity';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** עד כמה נושאי-על */
const MAX_TOPICS = 3;

/** עד כמה אשכולות. שישה נותנים 12 עד 30 שאלות, לפי מה שנבחר. */
const MAX_CLUSTERS = 6;

type Step = 'topics' | 'clusters' | 'stances' | 'results';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'topics', label: 'תחומים' },
  { id: 'clusters', label: 'נושאים' },
  { id: 'stances', label: 'עמדות' },
  { id: 'results', label: 'תוצאות' },
];

interface AgendaScore {
  issueId: string;
  label: string;
  billsInitiated: number;
  billsAdvanced: number;
  supportingVotes: number;
  voteOpportunities: number;
  stanceAware: boolean;
  score: number;
}

interface Row {
  mkId: number;
  name: string;
  faction: string | null;
  slug: string | null;
  isCoalition: boolean;
  isMinister: boolean;
  overallScore: number;
  evidenceCount: number;
  confidencePercent: number;
  perAgenda: AgendaScore[];
  photo: string | null;
  occupation: string | null;
  education: string | null;
  tenure: string | null;
}

export default function KeywordMatchClient() {
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('topics');
  const [topics, setTopics] = useState<string[]>([]);
  const [clusters, setClusters] = useState<string[]>([]);
  const [stances, setStances] = useState<Record<string, string>>({});

  const [rows, setRows] = useState<Row[]>([]);
  const [totalRanked, setTotalRanked] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * ?topics=a,b מגיע ממסך הבית, ששם נבחר השלב הראשון. כשהוא תקין
   * מדלגים ישר לבחירת הנושאים, כדי שלא נבקש מהמשתמשת לבחור תחומים
   * פעמיים.
   */
  useEffect(() => {
    const raw = searchParams.get('topics');
    if (!raw) return;

    const valid = raw
      .split(',')
      .filter(id => CLUSTER_TOPICS.some(t => t.id === id))
      .slice(0, MAX_TOPICS);

    if (valid.length > 0) {
      setTopics(valid);
      setStep('clusters');
    }
  }, [searchParams]);

  /**
   * מעבר שלב מחזיר לראש העמוד.
   *
   * בלי זה המשתמשת נוחתת באמצע הרשימה: שלב העמדות ארוך, והדפדפן שומר
   * את מיקום הגלילה — כך שמסך התוצאות נפתח כשהמדורגים הראשונים מעליה.
   */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const visibleClusters = useMemo(
    () => topics.map(id => ({ topic: CLUSTER_TOPICS.find(t => t.id === id)!, list: clustersOfTopic(id) })),
    [topics],
  );

  const chosenClusters = useMemo(
    () => clusters.map(id => getCluster(id)).filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [clusters],
  );

  const questionCount = chosenClusters.reduce((s, c) => s + c.questions.length, 0);
  const answered = Object.keys(stances).length;

  function toggleTopic(id: string) {
    setTopics(prev => {
      if (prev.includes(id)) {
        /** ביטול תחום מנקה גם את האשכולות והתשובות שמתחתיו */
        const dropped = clustersOfTopic(id).map(c => c.clusterId);
        setClusters(cs => cs.filter(c => !dropped.includes(c)));
        setStances(st => {
          const next = { ...st };
          for (const cid of dropped) {
            for (const q of getCluster(cid)?.questions ?? []) delete next[q.issueId];
          }
          return next;
        });
        return prev.filter(t => t !== id);
      }
      if (prev.length >= MAX_TOPICS) return prev;
      return [...prev, id];
    });
  }

  function toggleCluster(id: string) {
    setClusters(prev => {
      if (prev.includes(id)) {
        setStances(st => {
          const next = { ...st };
          for (const q of getCluster(id)?.questions ?? []) delete next[q.issueId];
          return next;
        });
        return prev.filter(c => c !== id);
      }
      if (prev.length >= MAX_CLUSTERS) return prev;
      return [...prev, id];
    });
  }

  function pickStance(issueId: string, stanceId: string) {
    setStances(prev => {
      if (prev[issueId] === stanceId) {
        const next = { ...prev };
        delete next[issueId];
        return next;
      }
      return { ...prev, [issueId]: stanceId };
    });
  }

  async function run() {
    setStep('results');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BASE_PATH}/api/agenda-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: Object.entries(stances).map(([issueId, stanceId]) => ({ issueId, stanceId })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'הבקשה נכשלה');

      setRows(json.rows ?? []);
      setTotalRanked(json.totalRanked ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה לא ידועה');
    } finally {
      setLoading(false);
    }
  }

  function restart() {
    setStep('topics');
    setTopics([]);
    setClusters([]);
    setStances({});
    setRows([]);
    setError(null);
  }

  function back() {
    if (step === 'results') return setStep('stances');
    if (step === 'stances') return setStep('clusters');
    if (step === 'clusters') return setStep('topics');
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <h1 className="text-2xl font-black">מי עובד בשבילך</h1>
          <Link href="/agenda-match" className="text-xs font-black underline text-gray-500 hover:text-black">
            לגרסה הישנה ←
          </Link>
        </div>

        {/*
          מחוון התקדמות עם מצב "הושלם" ולא רק "פעיל". בלי זה המשתמשת
          אינה יודעת כמה נשאר, וזו אחת הסיבות שנוטשים שאלון באמצע.
        */}
        <div className="flex items-center gap-0 mb-8">
          {STEPS.map((s, i) => {
            const current = STEPS.findIndex(x => x.id === step);
            const done = i < current;
            const active = i === current;
            return (
              <div key={s.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black transition-colors ${
                      active
                        ? 'bg-teal-600 text-white'
                        : done
                          ? 'bg-teal-100 text-teal-700'
                          : 'bg-gray-100 text-gray-300'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span
                    className={`text-[11px] font-black hidden sm:inline ${
                      active ? 'text-gray-900' : done ? 'text-teal-700' : 'text-gray-300'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-2 rounded-full ${done ? 'bg-teal-200' : 'bg-gray-100'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* ---------------------------- שלב 1 ---------------------------- */}
        {step === 'topics' && (
          <div>
            <h2 className="text-lg font-black mb-1">מה מעניין אותך?</h2>
            <p className="text-sm text-gray-600 font-medium mb-6 leading-relaxed">
              בחרי עד {MAX_TOPICS} תחומים. בשלב הבא תראי את הנושאים שבתוכם ותבחרי מה מדבר אלייך.
            </p>

            <div className="grid sm:grid-cols-2 gap-2.5">
              {CLUSTER_TOPICS.map(t => {
                const on = topics.includes(t.id);
                const full = topics.length >= MAX_TOPICS && !on;
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTopic(t.id)}
                    disabled={full}
                    className={`text-right p-4 rounded-xl border-2 transition-colors ${
                      on
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : full
                          ? 'border-black/8 text-gray-300 cursor-not-allowed bg-white'
                          : 'border-black/10 bg-white hover:border-teal-400'
                    }`}
                  >
                    <div className="text-sm font-black leading-snug">{t.label}</div>
                    <div className={`text-[11px] font-medium mt-1 ${on ? 'text-teal-100' : 'text-gray-400'}`}>
                      {t.clusters.length} נושאים · {t.billCount.toLocaleString()} הצעות חוק
                    </div>
                  </button>
                );
              })}
            </div>

            <StickyBar>
              <button
                onClick={() => setStep('clusters')}
                disabled={topics.length === 0}
                className="w-full px-5 py-3 rounded-lg bg-black text-white font-black text-sm disabled:opacity-25 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
              >
                {topics.length === 0 ? 'בחרי לפחות תחום אחד' : `המשך · ${topics.length} תחומים`}
              </button>
            </StickyBar>
          </div>
        )}

        {/* ---------------------------- שלב 2 ---------------------------- */}
        {step === 'clusters' && (
          <div>
            <h2 className="text-lg font-black mb-1">אילו נושאים חשובים לך?</h2>
            <p className="text-sm text-gray-600 font-medium mb-6 leading-relaxed">
              בחרי עד {MAX_CLUSTERS}. לכל נושא יש 2 עד 5 שאלות, ותעני רק על מה שבחרת.
            </p>

            {visibleClusters.map(({ topic, list }) => (
              <div key={topic.id} className="mb-6">
                <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
                  {topic.label}
                </div>
                <div className="flex flex-wrap gap-2">
                  {list.map(c => {
                    const on = clusters.includes(c.clusterId);
                    const full = clusters.length >= MAX_CLUSTERS && !on;
                    return (
                      <button
                        key={c.clusterId}
                        onClick={() => toggleCluster(c.clusterId)}
                        disabled={full}
                        title={c.questions.map(q => q.keyword).join(' · ')}
                        className={`text-xs font-black px-3 py-2.5 rounded-lg border-2 transition-colors ${
                          on
                            ? 'border-teal-600 bg-teal-600 text-white'
                            : full
                              ? 'border-black/8 text-gray-300 cursor-not-allowed bg-white'
                              : 'border-black/10 bg-white hover:border-teal-400'
                        }`}
                      >
                        {c.label}
                        <span className={`mr-1.5 text-[10px] font-medium ${on ? 'text-teal-100' : 'text-gray-400'}`}>
                          {c.questions.length} שאלות
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <StickyBar>
              <button onClick={back} className="px-4 py-3 rounded-lg border-2 border-black/10 bg-white font-black text-sm hover:border-black/25 transition-colors">
                חזרה
              </button>
              <button
                onClick={() => setStep('stances')}
                disabled={clusters.length === 0}
                className="flex-1 px-5 py-3 rounded-lg bg-black text-white font-black text-sm disabled:opacity-25 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
              >
                {clusters.length === 0 ? 'בחרי לפחות נושא אחד' : `המשך · ${questionCount} שאלות`}
              </button>
            </StickyBar>
          </div>
        )}

        {/* ---------------------------- שלב 3 ---------------------------- */}
        {step === 'stances' && (
          <div>
            <h2 className="text-lg font-black mb-1">מה העמדה שלך?</h2>
            <p className="text-sm text-gray-600 font-medium mb-6 leading-relaxed">
              אפשר לדלג על שאלה שאין לך עמדה לגביה — היא פשוט לא תיספר.
            </p>

            {chosenClusters.map(cluster => (
              <div key={cluster.clusterId} className="mb-7">
                <div className="text-[11px] font-black text-teal-700 uppercase tracking-widest mb-2.5">
                  {cluster.label}
                </div>

                <div className="flex flex-col gap-3">
                  {cluster.questions.map(q => {
                    const answeredHere = Boolean(stances[q.issueId]);
                    return (
                      <div
                        key={q.issueId}
                        className={`rounded-xl border-2 p-4 transition-colors ${
                          answeredHere ? 'border-teal-600/40 bg-teal-50/30' : 'border-black/8'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <h3 className="text-sm font-black leading-relaxed flex-1">{q.question}</h3>
                          {answeredHere && (
                            <span className="shrink-0 w-5 h-5 rounded-full bg-teal-600 text-white text-[11px] font-black flex items-center justify-center">
                              ✓
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 font-medium mb-3">
                          {q.keyword} · {q.billCount} הצעות חוק
                        </p>

                        {/*
                          מספור הצדדים ולא רק צבע: שתי העמדות ארוכות ודומות
                          באורכן, ובלי עוגן ויזואלי קשה לראות שאלו שתי
                          אפשרויות ולא שתי פסקאות.
                        */}
                        <div className="flex flex-col gap-2">
                          {q.stances.map((s, si) => {
                            const on = stances[q.issueId] === s.id;
                            return (
                              <button
                                key={s.id}
                                onClick={() => pickStance(q.issueId, s.id)}
                                className={`flex items-start gap-2.5 text-right text-xs font-black px-3 py-2.5 rounded-lg border-2 transition-all leading-relaxed ${
                                  on
                                    ? 'border-teal-600 bg-teal-600 text-white shadow-sm'
                                    : 'border-black/10 bg-white hover:border-teal-400 hover:bg-teal-50/40'
                                }`}
                              >
                                <span
                                  className={`shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center text-[9px] ${
                                    on ? 'border-white bg-white text-teal-600' : 'border-gray-300 text-gray-400'
                                  }`}
                                >
                                  {on ? '✓' : si === 0 ? 'א' : 'ב'}
                                </span>
                                <span className="flex-1">{s.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <StickyBar>
              <button onClick={back} className="px-4 py-3 rounded-lg border-2 border-black/10 bg-white font-black text-sm hover:border-black/25 transition-colors">
                חזרה
              </button>
              <button
                onClick={run}
                disabled={answered === 0}
                className="flex-1 px-5 py-3 rounded-lg bg-black text-white font-black text-sm disabled:opacity-25 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
              >
                {answered === 0 ? 'עני על לפחות שאלה אחת' : `לתוצאות · ${answered} תשובות`}
              </button>
            </StickyBar>
          </div>
        )}

        {/* ---------------------------- שלב 4 ---------------------------- */}
        {step === 'results' && (
          <div>
            {loading && (
              <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">מחשב...</div>
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
                <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
                  <h2 className="text-lg font-black">הפעילים ביותר בנושאים שלך</h2>
                  <span className="text-xs text-gray-500 font-medium">{totalRanked} בדירוג</span>
                </div>

                <div className="rounded-xl border-2 border-indigo-600/20 bg-indigo-50/50 p-4 mb-5 text-xs font-medium leading-relaxed text-gray-700">
                  <div className="text-[11px] font-black text-indigo-700 uppercase tracking-widest mb-2">
                    איך לקרוא את המספרים
                  </div>
                  <p className="mb-2">
                    <strong className="text-gray-900">ציון</strong> — כמה חבר הכנסת פעל לכיוון שבחרת.
                    משקלל 60% יוזמת חקיקה ו-40% תמיכה בהצבעות, כאחוזון מול שאר הפעילים באותו נושא.
                  </p>
                  <p className="mb-2">
                    <strong className="text-gray-900">ביטחון</strong> — כמה פעולות מתועדות עמדו מאחורי
                    הציון. אמירה על כמות המידע, לא על טיב ההתאמה.
                  </p>
                  <p className="pt-2 border-t border-indigo-600/15">
                    רוב הצעות החוק הפרטיות אינן מגיעות להצבעה, ולכן יוזמה היא האות המרכזי.
                    <strong className="text-gray-900"> לחברי אופוזיציה יש בממוצע יותר יוזמות</strong>,
                    ולכן רמת הביטחון שלהם נוטה להיות גבוהה יותר — זה אינו אומר שהם מתאימים לך יותר.
                  </p>
                </div>

                <ol className="flex flex-col gap-3">
                  {rows.slice(0, 10).map((row, idx) => (
                    <li
                      key={row.mkId}
                      className={`rounded-xl border p-4 transition-colors ${
                        idx === 0 ? 'border-teal-600/40 bg-teal-50/25' : 'border-black/8'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-sm font-black w-6 shrink-0 tabular-nums text-center ${
                            idx < 3 ? 'text-teal-700' : 'text-gray-300'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <MkAvatar name={row.name} photo={row.photo} isCoalition={row.isCoalition} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-black">{row.name}</h3>
                            {row.isMinister && (
                              <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                                שר/ה
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 font-medium mt-0.5">
                            {row.faction ?? 'ללא סיעה'} · {row.isCoalition ? 'קואליציה' : 'אופוזיציה'}
                          </p>
                          <MkBackground
                            occupation={row.occupation}
                            education={row.education}
                            tenure={row.tenure}
                            className="mt-1"
                          />
                        </div>
                        <div className="shrink-0 text-left">
                          <div className="text-xl font-black tabular-nums">{row.overallScore}</div>
                          <div className="text-[10px] text-gray-400 font-black">מתוך 100</div>
                          <div
                            className={`text-[10px] font-black mt-1 tabular-nums ${
                              row.confidencePercent >= 70
                                ? 'text-emerald-700'
                                : row.confidencePercent >= 40
                                  ? 'text-amber-700'
                                  : 'text-gray-400'
                            }`}
                            title={`${row.evidenceCount} פעולות מתועדות`}
                          >
                            ביטחון {row.confidencePercent}%
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${idx === 0 ? 'bg-teal-600' : 'bg-black'}`}
                          style={{ width: `${Math.min(100, row.overallScore)}%` }}
                        />
                      </div>

                      {/*
                        פירוט הפעילות מתחת לציון. בלי זה המשתמשת רואה מספר
                        ואינה יודעת ממה הוא מורכב — שלוש הצעות חוק ועשרים
                        הצבעות נראים זהים לשלוש הצבעות ועשרים הצעות.
                      */}
                      <div className="mt-2.5 flex items-center gap-3 flex-wrap text-[11px] font-medium text-gray-500">
                        <span>
                          <strong className="text-gray-900 font-black tabular-nums">
                            {row.perAgenda.reduce((s, a) => s + a.billsInitiated, 0)}
                          </strong>{' '}
                          הצעות חוק שיזם
                        </span>
                        <span className="text-gray-200">·</span>
                        <span>
                          <strong className="text-gray-900 font-black tabular-nums">
                            {row.perAgenda.reduce((s, a) => s + a.supportingVotes, 0)}
                          </strong>{' '}
                          הצבעות תומכות
                        </span>
                        {row.perAgenda.reduce((s, a) => s + a.billsAdvanced, 0) > 0 && (
                          <>
                            <span className="text-gray-200">·</span>
                            <span className="text-teal-700">
                              <strong className="font-black tabular-nums">
                                {row.perAgenda.reduce((s, a) => s + a.billsAdvanced, 0)}
                              </strong>{' '}
                              עברו קריאה טרומית
                            </span>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-6 flex gap-3">
                  <button onClick={back} className="text-xs font-black underline text-gray-600">
                    לשנות תשובות
                  </button>
                  <button onClick={restart} className="text-xs font-black underline text-gray-600">
                    להתחיל מחדש
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'topics' && (
          <p className="text-[11px] text-gray-300 font-medium mt-10 text-center">
            {CLUSTER_STATS.clusters} נושאים · {CLUSTER_STATS.questions} שאלות · נגזרו מ-7,067 הצעות חוק
          </p>
        )}
      </div>
    </div>
  );
}

function StickyBar({ children }: { children: React.ReactNode }) {
  return <div className="sticky bottom-4 mt-8 flex gap-2 bg-white/80 backdrop-blur-sm rounded-lg">{children}</div>;
}
