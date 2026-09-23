'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePeriod, periodToDateRange } from '@/lib/period-context';
import { CLUSTER_TOPICS } from '@/lib/axis-clusters';
import { TOPIC_COLOR, TOPIC_FALLBACK } from '@/lib/ui/colors';
import { Sparkline } from '@/components/Sparkline';
import { WeightingNotice } from '@/components/WeightingNotice';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** כמה תחומים נבחרים כאן. זהה ל-MAX_TOPICS ב-/agenda-keywords */
const HOME_DOMAIN_PICKS = 3;

/**
 * שמונת נושאי-העל של הטקסונומיה הקנונית.
 *
 * הוחלפו מ-DOMAINS של agendas.ts: אלה נכתבו ידנית מראש, ואלה נגזרו
 * מ-7,067 הצעות חוק. הבחירה כאן ממשיכה ל-/agenda-keywords, שמציג את
 * הנושאים שבתוך התחום לפני שהוא שואל — כדי שלא ייבחרו שאלות במקום
 * המשתמשת, כפי שקרה במסלול הקודם.
 */
const PICKABLE_DOMAINS = CLUSTER_TOPICS;

/**
 * שאלות לדוגמה מתחת לתיבת החיפוש.
 *
 * תיבת חיפוש ריקה אינה מלמדת מה מותר לשאול, ומי שלא יודע פשוט לא
 * שואל. שלוש דוגמאות קונקרטיות עושות את זה בשורה אחת.
 */
const EXAMPLE_QUERIES = [
  'כמה ישיבות קיימה ועדת הכספים?',
  'אילו חוקים עברו בנושא דיור?',
  'מי יזם הכי הרבה הצעות חוק?',
];

interface Stats {
  mks: number;
  committees: number;
  sessions: number;
  billsPassed: number;
  billsTotal: number;
  votes: number;
  trends?: { votes: number[]; billsPassed: number[]; sessions: number[] };
}

function relativeDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'היום';
  if (diffDays === 1) return 'אתמול';
  if (diffDays < 7) return `לפני ${diffDays} ימים`;
  if (diffDays < 30) return `לפני ${Math.floor(diffDays / 7)} שבועות`;
  if (diffDays < 365) return `לפני ${Math.floor(diffDays / 30)} חודשים`;
  return `לפני ${Math.floor(diffDays / 365)} שנים`;
}

/** כרטיס מספר בראש העמוד. trend ו-series קיימים רק למי שיש לו סדרה חודשית. */
interface StatCard {
  href: string;
  n: string;
  label: string;
  sub?: string;
  trend?: number[];
  series?: string;
  /** הזהב שמור לחוקים שעברו — המספר שהאתר קיים בשבילו */
  gold?: boolean;
}

interface RecentBill {
  id: number;
  title: string;
  date: string | null;
  macroAgenda: string | null;
}

/**
 * שלוש שאלות מתוך "הידעת?" לתצוגה בכרטיס.
 *
 * נבחרו כאלה שהתשובה עליהן אינה נחשת מראש — הן מה שגורם ללחוץ.
 * הרשימה המלאה חיה ב-/did-you-know; אם מוסיפים שם שאלה, כאן לא
 * חייבים לגעת.
 */
const DID_YOU_KNOW_TEASERS = [
  'למה כתוב 123 חברי כנסת, אם בכנסת 120 מושבים?',
  'מדוע הדירוג אינו מבוסס על חוקים שעברו?',
  'ח"כ שלא הופיע בתוצאות — לא עושה את עבודתו?',
];

const SECTIONS = [
  { label: 'ח"כים', sublabel: 'חברי הכנסת ה-25', href: '/mks' },
  { label: 'ועדות', sublabel: 'דיונים ופרוטוקולים', href: '/committees' },
  { label: 'חוקים', sublabel: 'הצעות חוק ומעקב', href: '/bills' },
  { label: 'פרוטוקולים', sublabel: 'חיפוש בתוך הדיונים', href: '/protocols' },
  { label: 'שרים', sublabel: 'חברי הממשלה', href: '/ministers' },
  { label: 'הצבעות', sublabel: 'הצבעות מליאה', href: '/votes' },
];

/** aiEnabled מגיע מ-page: דגל שרת שמאפשר לכבות את פיצ׳רי ה-AI */
export default function HomepageClient({ aiEnabled = true }: { aiEnabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentBills, setRecentBills] = useState<RecentBill[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [homeDomains, setHomeDomains] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { period } = usePeriod();

  function toggleHomeDomain(id: string) {
    setHomeDomains(prev => {
      if (prev.includes(id)) return prev.filter(d => d !== id);
      if (prev.length >= HOME_DOMAIN_PICKS) return prev;
      return [...prev, id];
    });
  }

  /** התחומים עוברים ב-query string, והשאלון פותח ישר בשלב העמדות */
  function startQuestionnaire() {
    if (homeDomains.length === 0) return;
    router.push(`/agenda-keywords?topics=${homeDomains.join(',')}`);
  }

  const fetchData = useCallback(async () => {
    const dateRange = periodToDateRange(period);
    const params = new URLSearchParams();
    if (dateRange) { params.set('from', dateRange.from); params.set('to', dateRange.to); }
    const qs = params.toString() ? `?${params}` : '';
    /*
      קודם היה כאן .catch(() => {}) על שתי הקריאות: כשל בשרת נבלע בשקט
      והמשתמשת ראתה דף חסר בלי שום הסבר.
    */
    Promise.all([
      fetch(`${BASE_PATH}/api/homepage-stats${qs}`)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(setStats),
      fetch(`${BASE_PATH}/api/pulse${qs}`)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(d => setRecentBills(d.bills?.slice(0, 6) ?? [])),
    ])
      .then(() => setLoadError(false))
      .catch(() => setLoadError(true));
  }, [period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length >= 2) router.push(`/ask?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="min-h-screen" dir="rtl">
      {/*
        ה-hero כהה. זה מה שנותן לעמוד נקודת פתיחה במקום דף שמתחיל
        בכותרת, וזה גם מה שמאפשר להשתמש בזהב כטקסט — על הנייבי הוא
        6.8:1, על רקע בהיר הוא 2.6:1 ואסור בכל גודל.
      */}
      <div className="bg-navy-deep" data-surface="dark">
        <div className="max-w-3xl mx-auto px-6 pt-14 pb-12">
          <p className="flex items-center gap-2 text-meta text-navy-mute mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-lit" aria-hidden="true" />
            הכנסת ה-25
          </p>

          <h1 className="text-page sm:text-5xl text-white mb-3">אפרכסת לכנסת</h1>
          <p className="text-body text-navy-soft max-w-xl">
            הצבעות, פרוטוקולים, חוקים, ח&quot;כים וועדות — כל הנתונים של הכנסת ה-25 במקום אחד.
          </p>

        </div>
      </div>

      {loadError && (
        <div className="max-w-3xl mx-auto px-6 mt-10">
          <div role="alert" className="rounded-card border border-fail/30 bg-fail-wash px-4 py-3">
            <p className="text-ui text-ink">לא הצלחנו לטעון את נתוני הכנסת כרגע.</p>
            <button onClick={fetchData} className="text-ui font-medium text-accent underline mt-1">
              נסי לטעון שוב
            </button>
          </div>
        </div>
      )}

      {/*
        המספרים. כל כרטיס הוא קישור למקום שבו אפשר לבדוק אותו, ומי
        שיש לו סדרה חודשית מקבל גם גרף זעיר — המספר לבדו לא אומר אם
        הקצב עולה או יורד.
      */}
      {stats && (
        <div className="max-w-3xl mx-auto px-6 mt-10 mb-14">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { href: '/votes', n: stats.votes?.toLocaleString() ?? '—', label: 'הצבעות מליאה',
                sub: 'במליאת הכנסת', trend: stats.trends?.votes, series: 'הצבעות' },
              { href: '/bills?passedOnly=true', n: stats.billsPassed.toLocaleString(), label: 'חוקים עברו',
                sub: stats.billsTotal > 0 ? `מתוך ${stats.billsTotal.toLocaleString()} הצעות` : undefined,
                trend: stats.trends?.billsPassed, series: 'חוקים שעברו', gold: true },
              { href: '/committees', n: stats.committees.toLocaleString(), label: 'ועדות פעילות',
                sub: `${stats.sessions.toLocaleString()} ישיבות`, trend: stats.trends?.sessions, series: 'ישיבות ועדה' },
              /*
                ״מכהנים כעת״ טען יותר ממה שהנתונים יודעים. המספר מגיע
                מדגל אחד, mk_person.is_current, והוא 123 — בעוד שבכנסת
                120 מושבים. הטבלאות שהיו אמורות להסביר את הפער ריקות:
                mk_faction_history אפס שורות, ולכל אדם אותו טווח תאריכים.
              */
              { href: '/mks', n: stats.mks.toLocaleString(), label: 'חברי כנסת',
                sub: 'בכנסת ה-25' },
            ] as StatCard[]).map(c => (
              <Link
                key={c.href}
                href={c.href}
                className="flex flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent-lit hover:bg-surface-2"
              >
                <span className="text-meta text-mute">{c.label}</span>
                <span
                  className={`text-3xl font-display font-semibold leading-tight mt-1 ${c.gold ? 'text-accent' : 'text-ink'}`}
                  data-numeric
                >
                  {c.n}
                </span>
                {c.trend && c.trend.length > 1 && (
                  <span className={`mt-2 ${c.gold ? 'text-accent-lit' : 'text-mute'}`}>
                    <Sparkline values={c.trend} label={c.series ?? c.label} />
                  </span>
                )}
                {c.sub && <span className="text-meta text-mute mt-2">{c.sub}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/*
        "הידעת?" ראשון, לפני השאלון.

        הוא היה שורה דקה בתחתית ונראה כמו קישור שוליים, בזמן שהוא
        העמוד שמסביר למה אסור לקרוא דירוג כתשובה חד-משמעית. מי שרואה
        דירוג לפני שראה אותו יסיק ממנו יותר משהוא אומר, ולכן הוא עולה
        לכאן — מיד אחרי המספרים ולפני השאלון שמייצר את הדירוג.
      */}
      <div className="max-w-3xl mx-auto px-6 mb-8">
        <Link
          href="/did-you-know"
          className="block rounded-card border border-line bg-surface p-6 transition-colors hover:border-accent-lit group"
        >
          <h2 className="text-page mb-2 group-hover:text-accent transition-colors">הידעת?</h2>
          <p className="text-body text-ink-2 mb-4">
            מה הנתונים באתר אומרים — ומה הם לא. דירוג נראה חד-משמעי, ולכן קל
            להסיק ממנו יותר משהוא באמת אומר.
          </p>

          {/* השאלות עצמן. "מה הנתונים אומרים" מופשט; שאלה קונקרטית מסקרנת. */}
          <ul className="flex flex-col gap-1.5 mb-4">
            {DID_YOU_KNOW_TEASERS.map(q => (
              <li key={q} className="flex items-baseline gap-2 text-ui text-ink-2">
                <span className="text-accent-lit shrink-0" aria-hidden="true">·</span>
                {q}
              </li>
            ))}
          </ul>

          <span className="text-ui font-medium text-accent">
            לכל השאלות ←
          </span>
        </Link>
      </div>

      {/* שאלון ההתאמה — השלב הראשון יושב כאן, והמשכו ב-/agenda-keywords */}
      <div className="max-w-3xl mx-auto px-6 mb-14">
        <div className="rounded-card border border-accent-lit bg-accent-wash p-6">
          {/*
            ההיררכיה הייתה הפוכה: ״מי עובד בשבילך״ — השם שמסביר למה
            בכלל לעצור כאן — ישב ב-12.5 פיקסל מעל הוראת הפעלה ב-22.
            מה שמושך את העין צריך להיות מה שמסביר, לא מה שמורה.
          */}
          <h2 className="text-page mb-2">מי עובד בשבילך?</h2>
          <p className="text-body text-ink-2 mb-5">
            אפשר לבחור עד שלושה תחומים שחשובים לך, ונדרג את חברי הכנסת לפי מידת
            הפעילות שלהם — הצעות חוק שיזמו והצבעות שתמכו בהן.
          </p>

          {/*
            לכל תחום נקודה בצבע שלו. הצבע אינו קישוט: אותו תחום מקבל
            אותו גוון בשאלון, בתרשים ובכרטיסים, כדי שאפשר יהיה לעקוב
            אחריו בין מסכים בלי לקרוא את התווית בכל פעם.
          */}
          <WeightingNotice className="mb-5" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="בחירת תחומים">
            {PICKABLE_DOMAINS.map(d => {
              const selected = homeDomains.includes(d.id);
              const full = homeDomains.length >= HOME_DOMAIN_PICKS && !selected;
              const dot = TOPIC_COLOR[d.label] ?? TOPIC_FALLBACK;
              return (
                <button
                  key={d.id}
                  onClick={() => toggleHomeDomain(d.id)}
                  disabled={full}
                  aria-pressed={selected}
                  className={`flex items-center gap-2.5 text-right text-ui px-3 py-2.5 rounded-control border transition-colors ${
                    selected
                      ? 'border-accent bg-surface text-ink font-medium'
                      : full
                        ? 'border-line bg-surface text-mute opacity-50 cursor-not-allowed'
                        : 'border-line bg-surface text-ink-2 hover:border-accent hover:text-ink'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: dot }}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{d.label}</span>
                  {/* הסימון נוסף לצבע ולמסגרת — צבע לבדו אינו מצב */}
                  {selected && <span className="text-accent shrink-0" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 mt-5 flex-wrap">
            {/*
              הכפתור הראשי נייבי ולא זהב. בעיצוב המקורי הוא היה זהב על
              קלף, 1.58:1 — הפעולה הראשית בעמוד הייתה הדבר הכי קשה
              לקריאה בו.
            */}
            <button
              onClick={startQuestionnaire}
              disabled={homeDomains.length === 0}
              className="px-5 py-2.5 rounded-control bg-navy-deep text-white font-medium text-ui disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy transition-colors"
            >
              המשך לשאלון
            </button>
            <span className="text-label text-ink-2">
              {homeDomains.length > 0
                ? `${homeDomains.length === 1 ? 'נבחר תחום אחד' : `נבחרו ${homeDomains.length} תחומים`} מתוך ${HOME_DOMAIN_PICKS}`
                : `אפשר לבחור עד ${HOME_DOMAIN_PICKS} תחומים כדי להתחיל`}
            </span>
          </div>
        </div>
      </div>

      {/*
        השאלה הפתוחה. הייתה ב-hero ויורדה לכאן: היא מוגבלת במכסה יומית
        משותפת לכל המבקרים, והשאלון שמעליה חינמי ובלתי מוגבל. אין טעם
        להציע קודם את מה שעלול להיגמר.
      */}
      {aiEnabled && (
      <div className="max-w-3xl mx-auto px-6 mb-14">
        <div className="rounded-card border border-line bg-surface p-6">
          <h2 className="text-section mb-1">או שאלו שאלה משלכם</h2>
          <p className="text-ui text-ink-2 mb-4">
            חיפוש חופשי בפרוטוקולים, בהצבעות ובהצעות החוק. התשובה מצטטת את
            המקורות שעליהם היא נשענת.
          </p>

          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="flex-1 flex items-center border border-line rounded-control px-4 py-3 bg-paper focus-within:border-accent transition-colors">
              <svg className="w-4 h-4 text-mute shrink-0 ml-2" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="4.5"/><path d="m10 10 4 4"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="שאלו שאלה על פעילות הכנסת..."
                aria-label="חיפוש בפעילות הכנסת"
                className="flex-1 bg-transparent text-ui text-ink placeholder:text-mute"
                dir="rtl"
              />
            </div>
            {/* נייבי ולא זהב: הזהב הבהיר הוא 2.6:1 על רקע בהיר */}
            <button
              type="submit"
              disabled={query.trim().length < 2}
              className="px-5 py-3 rounded-control bg-navy-deep text-white text-ui font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy transition-colors shrink-0"
            >
              שאל
            </button>
          </form>

          {/* מה מותר לשאול. תיבה ריקה לא מלמדת את זה. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3">
            <span className="text-meta text-mute">לדוגמה:</span>
            {EXAMPLE_QUERIES.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => { setQuery(q); inputRef.current?.focus(); }}
                className="text-meta text-accent underline underline-offset-2 hover:text-accent-ink transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
)}


      <div className="max-w-3xl mx-auto px-6 mb-14">
        <h2 className="label-he mb-3">מקטעים</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SECTIONS.map(s => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-card border border-line bg-surface p-5 transition-colors hover:border-accent-lit hover:bg-surface-2 group"
            >
              <div className="text-ui font-medium text-ink group-hover:text-accent transition-colors">{s.label}</div>
              <div className="text-meta text-mute mt-0.5">{s.sublabel}</div>
            </Link>
          ))}
        </div>
      </div>

      {recentBills.length > 0 && (
        <div className="max-w-3xl mx-auto px-6 pb-20">
          <div className="flex items-center justify-between mb-3">
            <h2 className="label-he">חוקים שעברו לאחרונה</h2>
            <Link href="/bills?passedOnly=true" className="text-meta font-medium text-accent hover:underline">
              כל החוקים ←
            </Link>
          </div>
          <div className="flex flex-col gap-1.5">
            {recentBills.map(b => (
              <Link
                key={b.id}
                href={`/bill/${b.id}`}
                className="flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 transition-colors hover:border-accent-lit"
              >
                <span className="shrink-0 text-meta font-medium bg-pass-wash text-pass px-2 py-0.5 rounded-control mt-0.5">עבר</span>
                <div className="flex-1 min-w-0">
                  <div className="text-ui font-medium text-ink leading-snug line-clamp-2">{b.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {b.date && <span className="text-meta text-mute">{relativeDate(b.date)}</span>}
                    {b.macroAgenda && (
                      <span className="text-meta text-accent-ink bg-accent-wash px-1.5 py-0.5 rounded-control">{b.macroAgenda}</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
