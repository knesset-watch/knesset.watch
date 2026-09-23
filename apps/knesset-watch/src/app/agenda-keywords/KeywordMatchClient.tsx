'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CLUSTER_TOPICS, clustersOfTopic, getCluster, CLUSTER_STATS } from '@/lib/axis-clusters';
import { TOPIC_COLOR, TOPIC_FALLBACK } from '@/lib/ui/colors';
import { countLabel } from '@/lib/ui/plural';
import { WeightingNotice } from '@/components/WeightingNotice';
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
  /** סיים את כהונתו בכנסת ה-25 */
  isFormer: boolean;
  /** YYYY-MM-DD, רק אצל מי שסיים */
  tenureEnd: string | null;
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
    <div className="min-h-screen bg-paper" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-baseline justify-between gap-4 mb-6">
          <h1 className="text-page">מי עובד בשבילך</h1>
          <p className="text-meta text-mute shrink-0">
            שלב {STEPS.findIndex(x => x.id === step) + 1} מתוך {STEPS.length}
          </p>
        </div>

        {/*
          מחוון התקדמות עם מצב "הושלם" ולא רק "פעיל". בלי זה המשתמשת
          אינה יודעת כמה נשאר, וזו אחת הסיבות שנוטשים שאלון באמצע.

          קודם היו כאן עיגולים על קו דק ותוויות אפורות, והמחוון נראה
          כמו קישוט. עכשיו הפס עצמו נושא את המצב: מלא לשלב שהושלם,
          זהב לשלב הנוכחי, ריק לשלבים הבאים.
        */}
        <ol className="flex gap-2 mb-10" aria-label="התקדמות בשאלון">
          {STEPS.map((s2, i) => {
            const current = STEPS.findIndex(x => x.id === step);
            const done = i < current;
            const active = i === current;
            return (
              <li key={s2.id} className="flex-1">
                <div
                  className={`h-1 rounded-full mb-2 transition-colors ${
                    done ? 'bg-accent' : active ? 'bg-accent-lit' : 'bg-line'
                  }`}
                />
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-meta font-medium ${
                      active ? 'text-ink' : done ? 'text-accent' : 'text-mute'
                    }`}
                  >
                    {s2.label}
                  </span>
                  {done && <span className="text-accent text-meta" aria-hidden="true">✓</span>}
                </div>
                <span className="sr-only">
                  {`שלב ${i + 1} מתוך ${STEPS.length}`}
                  {done ? ' — הושלם' : active ? ' — כאן עכשיו' : ' — טרם הגיע'}
                </span>
              </li>
            );
          })}
        </ol>

        {/* ---------------------------- שלב 1 ---------------------------- */}
        {step === 'topics' && (
          <div>
            <h2 className="text-section font-medium mb-1">מה מעניין אותך?</h2>
            <p className="text-ui text-ink-2 font-medium mb-4 leading-relaxed">
              אפשר לבחור עד {MAX_TOPICS} תחומים. בשלב הבא יופיעו הנושאים שבתוכם, ואפשר לבחור מה מהם מדבר אליך.
            </p>

            {/* גם כאן: הבחירה בכמה תחומים מתחילה בשלב הזה */}
            <WeightingNotice className="mb-6" />

            <div className="grid sm:grid-cols-2 gap-2.5">
              {CLUSTER_TOPICS.map(t => {
                const on = topics.includes(t.id);
                const full = topics.length >= MAX_TOPICS && !on;
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTopic(t.id)}
                    aria-pressed={on}
                    disabled={full}
                    className={`text-right p-4 rounded-card border transition-colors ${
                      on
                        ? 'border-accent bg-accent-wash'
                        : full
                          ? 'border-line text-mute cursor-not-allowed bg-surface opacity-50'
                          : 'border-line bg-surface hover:border-accent'
                    }`}
                  >
                    {/* הנקודה היא מזהה: אותו תחום, אותו גוון בכל האתר */}
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: TOPIC_COLOR[t.label] ?? TOPIC_FALLBACK }}
                        aria-hidden="true"
                      />
                      <span className="text-ui font-medium leading-snug flex-1 text-ink">{t.label}</span>
                      {on && <span className="text-accent shrink-0" aria-hidden="true">✓</span>}
                    </div>
                    <div className="text-meta text-mute mt-1.5 pr-5">
                      {countLabel(t.clusters.length, 'נושא אחד', 'נושאים')} · {countLabel(t.billCount, 'הצעת חוק אחת', 'הצעות חוק')}
                    </div>
                  </button>
                );
              })}
            </div>

            <StickyBar>
              <button
                onClick={() => setStep('clusters')}
                disabled={topics.length === 0}
                className="px-6 py-3 rounded-control bg-navy-deep text-white font-medium text-ui disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy transition-colors"
              >
                המשך
              </button>
              <span className="text-label text-ink-2">
                {topics.length === 0
                  ? 'צריך לבחור לפחות תחום אחד'
                  : `${topics.length === 1 ? 'נבחר תחום אחד' : `נבחרו ${topics.length} תחומים`} מתוך ${MAX_TOPICS}`}
              </span>
            </StickyBar>
          </div>
        )}

        {/* ---------------------------- שלב 2 ---------------------------- */}
        {step === 'clusters' && (
          <div>
            <h2 className="text-section font-medium mb-1">אילו נושאים חשובים לך?</h2>
            <p className="text-ui text-ink-2 font-medium mb-4 leading-relaxed">
              אפשר לבחור עד {MAX_CLUSTERS}. לכל נושא יש 2 עד 5 שאלות, ואפשר לענות רק על מה שנבחר.
            </p>

            <WeightingNotice className="mb-6" />

            {visibleClusters.map(({ topic, list }) => (
              <div key={topic.id} className="mb-6">
                {/*
                  הכותרת הייתה קטנה ואפורה יותר מהפריטים שתחתיה, ולכן לא
                  נקראה ככותרת. לעברית אין רישיות להישען עליהן — המשקל,
                  הצבע והנקודה עושים את זה.
                */}
                <h3 className="flex items-center gap-2 text-ui font-semibold text-ink mb-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: TOPIC_COLOR[topic.label] ?? TOPIC_FALLBACK }}
                    aria-hidden="true"
                  />
                  {topic.label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {list.map(c => {
                    const on = clusters.includes(c.clusterId);
                    const full = clusters.length >= MAX_CLUSTERS && !on;
                    return (
                      <button
                        key={c.clusterId}
                        onClick={() => toggleCluster(c.clusterId)}
                        aria-pressed={on}
                        disabled={full}
                        title={c.questions.map(q => q.keyword).join(' · ')}
                        className={`text-right px-3 py-2 rounded-control border transition-colors ${
                          on
                            ? 'border-accent bg-accent-wash'
                            : full
                              ? 'border-line text-mute cursor-not-allowed bg-surface opacity-50'
                              : 'border-line bg-surface hover:border-accent'
                        }`}
                      >
                        {/*
                          "בתי ספר וגיל הרך 5 שאלות" באותו גודל ובאותה שורה
                          נקרא כמשפט אחד. הספירה יורדת שורה ומתעמעמת.
                        */}
                        <span className="flex items-center gap-1.5">
                          {on && <span className="text-accent text-meta shrink-0" aria-hidden="true">✓</span>}
                          <span className="text-ui text-ink leading-snug">{c.label}</span>
                        </span>
                        <span className="block text-meta text-mute mt-0.5">
                          {countLabel(c.questions.length, 'שאלה אחת', 'שאלות')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <StickyBar>
              <button onClick={back} className="px-4 py-3 rounded-control border border-line bg-surface font-medium text-ui text-ink-2 hover:border-mute hover:text-ink transition-colors">
                חזרה
              </button>
              <button
                onClick={() => setStep('stances')}
                disabled={clusters.length === 0}
                className="px-6 py-3 rounded-control bg-navy-deep text-white font-medium text-ui disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy transition-colors"
              >
                המשך
              </button>
              <span className="text-label text-ink-2">
                {clusters.length === 0
                  ? 'צריך לבחור לפחות נושא אחד'
                  : `${countLabel(clusters.length, 'נושא אחד', 'נושאים')} · ${countLabel(questionCount, 'שאלה אחת', 'שאלות')}`}
              </span>
            </StickyBar>
          </div>
        )}

        {/* ---------------------------- שלב 3 ---------------------------- */}
        {step === 'stances' && (
          <div>
            <h2 className="text-section font-medium mb-1">מה העמדה שלך?</h2>
            <p className="text-ui text-ink-2 font-medium mb-6 leading-relaxed">
              אפשר לדלג על שאלה שאין לך עמדה לגביה — היא פשוט לא תיספר.
            </p>

            {chosenClusters.map(cluster => (
              <div key={cluster.clusterId} className="mb-7">
                <div className="text-meta font-medium text-accent mb-2.5">
                  {cluster.label}
                </div>

                <div className="flex flex-col gap-3">
                  {cluster.questions.map(q => {
                    const answeredHere = Boolean(stances[q.issueId]);
                    return (
                      <div
                        key={q.issueId}
                        className={`rounded-card border-2 p-4 transition-colors ${
                          answeredHere ? 'border-accent/40 bg-accent-wash/30' : 'border-line'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <h3 className="text-ui font-medium leading-relaxed flex-1">{q.question}</h3>
                          {answeredHere && (
                            <span className="shrink-0 w-5 h-5 rounded-full bg-accent text-white text-meta font-medium flex items-center justify-center">
                              ✓
                            </span>
                          )}
                        </div>
                        <p className="text-meta text-mute font-medium mb-3">
                          {q.keyword} · {q.billCount} הצעות חוק
                        </p>

                        {/*
                          מספור הצדדים ולא רק צבע: שתי העמדות ארוכות ודומות
                          באורכן, ובלי עוגן ויזואלי קשה לראות שאלו שתי
                          אפשרויות ולא שתי פסקאות.
                        */}
                        <div className="flex flex-col gap-2" role="radiogroup" aria-label={q.question}>
                          {q.stances.map((s, si) => {
                            const on = stances[q.issueId] === s.id;
                            return (
                              <button
                                key={s.id}
                                onClick={() => pickStance(q.issueId, s.id)}
                                role="radio"
                                aria-checked={on}
                                className={`flex items-start gap-2.5 text-right text-meta font-medium px-3 py-2.5 rounded-control border-2 transition-all leading-relaxed ${
                                  on
                                    ? 'border-accent bg-accent text-white shadow-sm'
                                    : 'border-line bg-surface hover:border-accent hover:bg-accent-wash/40'
                                }`}
                              >
                                <span
                                  className={`shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center text-meta ${
                                    on ? 'border-white bg-surface text-accent' : 'border-line text-mute'
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
              <button onClick={back} className="px-4 py-3 rounded-control border border-line bg-surface font-medium text-ui text-ink-2 hover:border-mute hover:text-ink transition-colors">
                חזרה
              </button>
              <button
                onClick={run}
                disabled={answered === 0}
                className="px-6 py-3 rounded-control bg-navy-deep text-white font-medium text-ui disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy transition-colors"
              >
                לתוצאות
              </button>
              <span className="text-label text-ink-2">
                {answered === 0
                  ? 'עני על לפחות שאלה אחת'
                  : `${countLabel(answered, 'תשובה אחת', 'תשובות')} מתוך ${questionCount}`}
              </span>
            </StickyBar>
          </div>
        )}

        {/* ---------------------------- שלב 4 ---------------------------- */}
        {step === 'results' && (
          <div>
            {loading && (
              <div className="py-32 text-center text-section font-medium animate-pulse opacity-20">מחשב...</div>
            )}

            {error && (
              <div className="rounded-card border border-fail/30 bg-fail-wash p-5">
                <p className="font-medium text-fail text-ui">{error}</p>
                <button onClick={restart} className="mt-3 text-meta font-medium underline text-fail">
                  להתחיל מחדש
                </button>
              </div>
            )}

            {!loading && !error && rows.length === 0 && (
              <div className="rounded-card border border-line bg-surface p-6">
                <p className="font-medium text-ui">לא נמצאו חברי כנסת פעילים בנושאים שנבחרו.</p>
                <button onClick={restart} className="mt-3 text-meta font-medium underline">
                  לבחור נושאים אחרים
                </button>
              </div>
            )}

            {!loading && !error && rows.length > 0 && (
              <>
                <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
                  <h2 className="text-section font-medium">הפעילים ביותר בנושאים שלך</h2>
                  <span className="text-meta text-mute font-medium">{totalRanked} בדירוג</span>
                </div>

                <div className="rounded-card border-2 border-accent-lit bg-accent-wash p-4 mb-5 text-meta font-medium leading-relaxed text-ink-2">
                  <div className="text-meta font-medium text-accent-ink mb-2">
                    איך לקרוא את המספרים
                  </div>
                  <p className="mb-2">
                    <strong className="text-ink">ציון</strong> — כמה חבר הכנסת פעל לכיוון שבחרת.
                    משקלל 60% יוזמת חקיקה ו-40% תמיכה בהצבעות, כאחוזון מול שאר הפעילים באותו נושא.
                  </p>
                  <p className="mb-2">
                    <strong className="text-ink">ביטחון</strong> — כמה פעולות מתועדות עמדו מאחורי
                    הציון. אמירה על כמות המידע, לא על טיב ההתאמה.
                  </p>
                  <p className="pt-2 border-t border-accent-lit">
                    רוב הצעות החוק הפרטיות אינן מגיעות להצבעה, ולכן יוזמה היא האות המרכזי.
                    <strong className="text-ink"> לחברי אופוזיציה יש בממוצע יותר יוזמות</strong>,
                    ולכן רמת הביטחון שלהם נוטה להיות גבוהה יותר — זה אינו אומר שהם מתאימים לך יותר.
                  </p>
                  <p className="pt-2 mt-2 border-t border-accent-lit">
                    <Link href="/did-you-know" className="font-medium text-accent hover:underline">
                      הידעת? למה שרים כמעט לא מופיעים כאן, ומה הדירוג לא מודד ←
                    </Link>
                  </p>
                </div>

                <ol className="flex flex-col gap-3">
                  {rows.slice(0, 10).map((row, idx) => (
                    <li
                      key={row.mkId}
                      className={`rounded-card border p-4 transition-colors ${
                        idx === 0 ? 'border-accent/40 bg-accent-wash/25' : 'border-line'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-ui font-medium w-6 shrink-0 tabular-nums text-center ${
                            idx < 3 ? 'text-accent' : 'text-mute'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <MkAvatar name={row.name} photo={row.photo} isCoalition={row.isCoalition} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-body font-medium">{row.name}</h3>
                            {row.isMinister && (
                              <span className="text-meta font-medium px-1.5 py-0.5 rounded bg-line text-ink-2">
                                שר/ה
                              </span>
                            )}
                            {/*
                              בלי התווית הזו המשתמשת מקבלת שם של מי שפעל
                              בכנסת ה-25 ומניחה שאפשר לפנות אליו היום.
                            */}
                            {row.isFormer && (
                              <span className="text-meta font-medium px-1.5 py-0.5 rounded bg-warn-wash text-warn">
                                {row.tenureEnd ? `כיהן עד ${formatMonth(row.tenureEnd)}` : 'סיים כהונה'}
                              </span>
                            )}
                          </div>
                          <p className="text-meta text-mute font-medium mt-0.5">
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
                          <div className="text-section font-medium tabular-nums">{row.overallScore}</div>
                          <div className="text-meta text-mute font-medium">מתוך 100</div>
                          <div
                            className={`text-meta font-medium mt-1 tabular-nums ${
                              row.confidencePercent >= 70
                                ? 'text-pass'
                                : row.confidencePercent >= 40
                                  ? 'text-warn'
                                  : 'text-mute'
                            }`}
                            title={`${row.evidenceCount} פעולות מתועדות`}
                          >
                            ביטחון {row.confidencePercent}%
                          </div>
                        </div>
                      </div>

                      {/*
                        הפס נצבע לפי סיעה, כמו בכל שאר האתר: נייבי לקואליציה
                        וזהב לאופוזיציה.

                        קודם הוא נצבע לפי דירוג — המקום הראשון בזהב והשאר
                        בנייבי — ואותם שני צבעים כבר סימנו סיעה במקום אחר.
                        התוצאה הייתה שארבע ח"כיות אופוזיציה נראו כאחת
                        אופוזיציה ושלוש קואליציה. המקום הראשון מסומן ממילא
                        במספר ובציון ואינו זקוק לצבע.

                        accent-lit ולא accent: הראשון מיועד לרקעים, השני
                        לטקסט על רקע בהיר.
                      */}
                      <div className="mt-3 h-1.5 rounded-full bg-line overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            row.isCoalition ? 'bg-navy' : 'bg-accent-lit'
                          }`}
                          style={{ width: `${Math.min(100, row.overallScore)}%` }}
                        />
                      </div>

                      {/*
                        פירוט הפעילות מתחת לציון. בלי זה המשתמשת רואה מספר
                        ואינה יודעת ממה הוא מורכב — שלוש הצעות חוק ועשרים
                        הצבעות נראים זהים לשלוש הצבעות ועשרים הצעות.
                      */}
                      <div className="mt-2.5 flex items-center gap-3 flex-wrap text-meta font-medium text-mute">
                        <span>
                          <strong className="text-ink font-medium tabular-nums">
                            {row.perAgenda.reduce((s, a) => s + a.billsInitiated, 0)}
                          </strong>{' '}
                          הצעות חוק שיזם
                        </span>
                        <span className="text-navy-soft">·</span>
                        <span>
                          <strong className="text-ink font-medium tabular-nums">
                            {row.perAgenda.reduce((s, a) => s + a.supportingVotes, 0)}
                          </strong>{' '}
                          הצבעות תומכות
                        </span>
                        {row.perAgenda.reduce((s, a) => s + a.billsAdvanced, 0) > 0 && (
                          <>
                            <span className="text-navy-soft">·</span>
                            <span className="text-accent">
                              <strong className="font-medium tabular-nums">
                                {row.perAgenda.reduce((s, a) => s + a.billsAdvanced, 0)}
                              </strong>{' '}
                              עברו קריאה טרומית
                            </span>
                          </>
                        )}
                      </div>

                      {/*
                        כיסוי: בכמה מהנושאים שנבחרו נמצא חומר על הח״כ הזה.

                        הציון מחולק במספר הנושאים שנבחרו, ולא במספר שהוא
                        פעיל בהם. מי שנוגע בשניים מתוך שישה מקבל ארבעה
                        אפסים בממוצע — וזה לא נראה בשום מקום בכרטיס.
                        שתי שורות עם אותו ציון יכולות להיות ״בינוני בכולם״
                        ו״חזק מאוד באחד״, ואלה דברים שונים לגמרי.

                        האפס עצמו מעורפל: הוא יכול להיות ״לא עשה כלום״,
                        אבל גם ״הצביע לצד השני״ או ״הצעת החוק שלו לא סווגה
                        לנושא הזה״. לכן הניסוח הוא ״נמצא חומר״ ולא ״פעל״.
                      */}
                      {(() => {
                        const activeIn = row.perAgenda.length;
                        const selected = clusters.reduce(
                          (n, id) => n + (getCluster(id)?.questions.length ?? 0),
                          0,
                        );
                        if (selected === 0) return null;
                        const partial = activeIn < selected;
                        return (
                          <p
                            className={`mt-1.5 text-meta ${partial ? 'text-warn' : 'text-mute'}`}
                            title="נושא ללא חומר נספר כאפס בממוצע"
                          >
                            נמצא חומר ב-{activeIn} מתוך {selected} הנושאים שבחרת
                          </p>
                        );
                      })()}
                    </li>
                  ))}
                </ol>

                <div className="mt-6 flex gap-3">
                  <button onClick={back} className="text-meta font-medium underline text-ink-2">
                    לשנות תשובות
                  </button>
                  <button onClick={restart} className="text-meta font-medium underline text-ink-2">
                    להתחיל מחדש
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'topics' && (
          <p className="text-meta text-mute font-medium mt-10 text-center">
            {CLUSTER_STATS.clusters} נושאים · {CLUSTER_STATS.questions} שאלות · נגזרו מ-7,067 הצעות חוק
          </p>
        )}
      </div>
    </div>
  );
}

/** "2025-07-04" → "7.2025". חודש מספיק — היום המדויק אינו מוסיף. */
function formatMonth(iso: string): string {
  const [y, m] = iso.split('-');
  return m && y ? `${Number(m)}.${y}` : iso;
}

function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 mt-10 -mx-6 px-6 py-4 flex items-center gap-3 flex-wrap bg-paper/95 backdrop-blur-sm border-t border-line">
      {children}
    </div>
  );
}
