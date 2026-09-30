'use client';

import { useState } from 'react';
import Link from 'next/link';
import { countLabel } from '@/lib/ui/plural';
import { WeightingNotice } from '@/components/WeightingNotice';
import { MkAvatar, MkBackground } from '@/components/MkIdentity';
import { BY_TOPIC, STATEMENTS, stanceIdFor, type Answer } from './statements';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

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
  isFormer: boolean;
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

const OPTIONS: Array<[Answer, string, string]> = [
  ['pro', 'מסכימה', '✓'],
  ['con', 'לא מסכימה', '✗'],
  ['none', 'אין לי דעה', '–'],
];

/**
 * גרסת היגדים של השאלון, לבדיקה מול /agenda-keywords.
 *
 * הבודקות דיווחו על שאלות ארוכות ועל תשובות שאינן מאפשרות מענה מלא.
 * כאן כל ציר הוא משפט אחד עם מסכים / לא מסכים / אין לי דעה, במקום
 * שאלה ושתי עמדות באורך משפט כל אחת. חציון הקריאה יורד מ-33 מילים ל-10.
 *
 * שני הבדלים מהשאלון שבאוויר, שצריך לזכור כשקוראים את התוצאות:
 *
 * 1. אין משפך. השאלון מסנן עד שלושה נושאים ועד שישה אשכולות, ולכן
 *    משתמשת אמיתית לא רואה 20 היגדים משמונה נושאים. המסך הזה בודק את
 *    הניסוח, לא את המשפך.
 *
 * 2. "אין לי דעה" הוא מצב מפורש ולא היעדר בחירה. בשאלון הקיים ביטול
 *    בחירה בלחיצה חוזרת ממלא את אותו תפקיד, אבל אינו נראה — ואי-אפשר
 *    להבדיל בין "אין לי דעה" ל"לא הגעתי לשם". בבדיקה ההבדל הזה הוא
 *    בדיוק מה שרוצים למדוד.
 */
export default function HeigdimClient() {
  const [step, setStep] = useState<'statements' | 'results'>('statements');
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [totalRanked, setTotalRanked] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decided = STATEMENTS.filter(
    s => answers[s.issueId] === 'pro' || answers[s.issueId] === 'con',
  ).length;
  const noOpinion = STATEMENTS.filter(s => answers[s.issueId] === 'none').length;
  const untouched = STATEMENTS.length - decided - noOpinion;

  function pick(issueId: string, answer: Answer) {
    setAnswers(prev => {
      // לחיצה חוזרת על אותה תשובה מבטלת אותה, כמו בשאלון הקיים
      if (prev[issueId] === answer) {
        const next = { ...prev };
        delete next[issueId];
        return next;
      }
      return { ...prev, [issueId]: answer };
    });
  }

  async function run() {
    setStep('results');
    setLoading(true);
    setError(null);

    // רק מסכימה ולא-מסכימה נשלחים. "אין לי דעה" נספר במסך ואינו נכנס לחישוב.
    const selections = STATEMENTS.flatMap(s => {
      const stanceId = stanceIdFor(s.issueId, answers[s.issueId] ?? 'none');
      return stanceId ? [{ issueId: s.issueId, stanceId }] : [];
    });

    try {
      const res = await fetch(`${BASE_PATH}/api/agenda-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections }),
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
    setStep('statements');
    setAnswers({});
    setRows([]);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-paper" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-baseline justify-between gap-4 mb-6">
          <h1 className="text-page">מי עובד בשבילך</h1>
          <span className="text-meta font-medium px-2 py-1 rounded bg-warn-wash text-warn shrink-0">
            גרסת בדיקה
          </span>
        </div>

        {step === 'statements' && (
          <div>
            <h2 className="text-section font-medium mb-1">מה את חושבת?</h2>
            <p className="text-ui text-ink-2 font-medium mb-6 leading-relaxed">
              עשרים היגדים. מה שאין לך עליו דעה לא נספר — וזו תשובה לגיטימית,
              לא דילוג.
            </p>

            {BY_TOPIC.map(({ topic, items }) => (
              <div key={topic} className="mb-7">
                <div className="text-meta font-medium text-accent mb-2.5">{topic}</div>

                <div className="flex flex-col gap-3">
                  {items.map(s => {
                    const answer = answers[s.issueId];
                    return (
                      <div
                        key={s.issueId}
                        className={`rounded-card border-2 p-4 transition-colors ${
                          answer ? 'border-accent/40 bg-accent-wash/30' : 'border-line'
                        }`}
                      >
                        <h3 className="text-ui font-medium leading-relaxed mb-1">{s.text}</h3>
                        <p className="text-meta text-mute font-medium mb-3">
                          {s.billCount} הצעות חוק
                        </p>

                        {/*
                          שלושת הכפתורים אינם ירוק־אדום. pass ו-fail שמורים
                          במערכת העיצוב למצב אמיתי של חוק או הצבעה, ודעה של
                          משתמשת אינה מצב כזה. ההבחנה עוברת דרך אות עוגן
                          ודרך accent, כמו ב-א/ב בשאלון הקיים.
                        */}
                        <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label={s.text}>
                          {OPTIONS.map(([value, label, glyph]) => {
                            const on = answer === value;
                            return (
                              <button
                                key={value}
                                onClick={() => pick(s.issueId, value)}
                                role="radio"
                                aria-checked={on}
                                className={`flex items-center gap-2 text-ui font-medium px-4 py-2.5 rounded-control border-2 transition-all ${
                                  on
                                    ? 'border-accent bg-accent text-white shadow-sm'
                                    : 'border-line bg-surface hover:border-accent hover:bg-accent-wash/40'
                                }`}
                              >
                                <span
                                  className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center text-meta leading-none ${
                                    on ? 'border-white bg-surface text-accent' : 'border-line text-mute'
                                  }`}
                                >
                                  {glyph}
                                </span>
                                {label}
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
              <button
                onClick={run}
                disabled={decided === 0}
                className="px-6 py-3 rounded-control bg-navy-deep text-white font-medium text-ui disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy transition-colors"
              >
                לתוצאות
              </button>
              <span className="text-label text-ink-2">
                {decided === 0
                  ? 'צריך היגד אחד לפחות'
                  : `${countLabel(decided, 'תשובה אחת', 'תשובות')} מתוך ${STATEMENTS.length}`}
                {noOpinion > 0 && ` · ${noOpinion} בלי דעה`}
                {untouched > 0 && ` · ${untouched} טרם נענו`}
              </span>
            </StickyBar>
          </div>
        )}

        {step === 'results' && (
          <div>
            {loading && (
              <div className="py-32 text-center text-section font-medium animate-pulse opacity-20">
                מחשב...
              </div>
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
                <p className="font-medium text-ui">לא נמצאו חברי כנסת פעילים בהיגדים שנבחרו.</p>
                <button onClick={restart} className="mt-3 text-meta font-medium underline">
                  להתחיל מחדש
                </button>
              </div>
            )}

            {!loading && !error && rows.length > 0 && (
              <>
                <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
                  <h2 className="text-section font-medium">הפעילים ביותר בהיגדים שלך</h2>
                  <span className="text-meta text-mute font-medium">{totalRanked} בדירוג</span>
                </div>

                <WeightingNotice className="mb-5" />

                <div className="rounded-card border-2 border-accent-lit bg-accent-wash p-4 mb-5 text-meta font-medium leading-relaxed text-ink-2">
                  <div className="text-meta font-medium text-accent-ink mb-2">
                    איך לקרוא את המספרים
                  </div>
                  <p className="mb-2">
                    <strong className="text-ink">ציון</strong> — כמה חבר הכנסת פעל לכיוון שסימנת.
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

                      <div className="mt-3 h-1.5 rounded-full bg-line overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            row.isCoalition ? 'bg-navy' : 'bg-accent-lit'
                          }`}
                          style={{ width: `${Math.min(100, row.overallScore)}%` }}
                        />
                      </div>

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
                        המכנה הוא מספר ההיגדים שסומנו מסכימה או לא מסכימה,
                        ולא 20. היגד שסומן "אין לי דעה" אינו נשלח למנוע ולכן
                        אינו נספר כאפס בממוצע.
                      */}
                      <p
                        className={`mt-1.5 text-meta ${
                          row.perAgenda.length < decided ? 'text-warn' : 'text-mute'
                        }`}
                        title="היגד ללא חומר נספר כאפס בממוצע"
                      >
                        נמצא חומר ב-{row.perAgenda.length} מתוך {decided} ההיגדים שענית עליהם
                      </p>
                    </li>
                  ))}
                </ol>

                <div className="mt-6 flex gap-3 flex-wrap">
                  <button
                    onClick={() => setStep('statements')}
                    className="text-meta font-medium underline text-ink-2"
                  >
                    לשנות תשובות
                  </button>
                  <button onClick={restart} className="text-meta font-medium underline text-ink-2">
                    להתחיל מחדש
                  </button>
                  <Link
                    href="/agenda-keywords"
                    className="text-meta font-medium underline text-ink-2"
                  >
                    לגרסה עם השאלות
                  </Link>
                </div>
              </>
            )}
          </div>
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
