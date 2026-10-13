'use client';

import { useState, useMemo, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CLUSTER_TOPICS, clustersOfTopic, getCluster, CLUSTER_STATS } from '@/lib/axis-clusters';
import { TOPIC_COLOR, TOPIC_FALLBACK } from '@/lib/ui/colors';
import { DomainIcon } from '@/components/home/domain-icons';
import { countLabel } from '@/lib/ui/plural';
import { MkAvatar } from '@/components/MkIdentity';
import { PageContainer } from '@/components/PageContainer';
import { billStageLabel } from '@/lib/bill-stage';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * תקרת ההיגדים לשאלון אחד. אין מגבלה על תחומים ונושאים: המגבלה הישנה
 * (שלושה תחומים, שישה נושאים) הייתה שריד של מודל הממוצע, שדילל ככל שבחרו
 * יותר. במודל של היגד-היגד ההפך נכון, הסיכום לאורך ההיגדים אמין יותר ככל
 * שעונים על יותר. נשארה רק התקרה של ה-API (MAX_SELECTIONS ב-api/agenda-leaders),
 * כי כל היגד עולה כ-70 אלפיות שנייה של חישוב, ו-45 הם כ-3 שניות.
 */
const MAX_STATEMENTS = 45;

type Step = 'topics' | 'clusters' | 'stances' | 'results';

/** הצעת חוק אחת, כפי שה-API מחזיר אותה. statusId לתווית השלב */
interface BillRef {
  billId: number;
  title: string;
  statusId: number;
  advanced: boolean;
  passed: boolean;
  /** ממשלתית (מגיעה לרשימת ח"כ רק דרך מיזוג עם הצעה פרטית) או של ועדה */
  kind?: 'government' | 'committee';
  /** הקרדיט ניתן כיו"ר הוועדה שהגישה, לא כיוזם חתום */
  viaChair?: boolean;
}

/** הצבעה אחת. supportive = דוחפת לכיוון שלך; withFaction = כמו רוב הסיעה */
interface VoteRef {
  voteId: number;
  billId: number | null;
  title: string;
  date: string;
  votedFor: boolean;
  supportive: boolean;
  withFaction: boolean | null;
  statusId: number | null;
  /** ההצבעה היא על הצעה ממשלתית */
  government?: boolean;
}

interface StageCounts { filed: number; advanced: number; law: number }
interface FactionCounts { withFaction: number; againstFaction: number }

/** ח"כ אחד בהיגד אחד, כפי ש-/api/agenda-leaders מחזיר */
interface Leader {
  mkId: number;
  name: string;
  faction: string | null;
  slug: string | null;
  isCoalition: boolean;
  isMinister: boolean;
  isFormer: boolean;
  tenureEnd: string | null;
  rank: number;
  score: number;
  consistency: number;
  pushFor: number;
  pushAgainst: number;
  billsFor: StageCounts;
  billsAgainst: StageCounts;
  votesFor: FactionCounts;
  votesAgainst: FactionCounts;
  bills: BillRef[];
  billsAgainstRefs: BillRef[];
  votes: VoteRef[];
  photo: string | null;
  occupation: string | null;
  tenure: string | null;
}

interface StatementResult {
  issueId: string;
  label: string;
  yourSide: string | null;
  otherSide: string | null;
  billCount: number;
  billsYourSide: number;
  billsOtherSide: number;
  /** מתוך הנ"ל: הצעות ממשלתיות, וכמה מהן הפכו לחוק */
  govYourSide: { bills: number; laws: number };
  govOtherSide: { bills: number; laws: number };
  voteCount: number;
  activeMks: number;
  leaderNet: number;
  leaders: Leader[];
}

/** שורה בסיכום לאורך ההיגדים, כפי ש-/api/agenda-leaders מחזיר (summary.rows) */
interface SummaryRow {
  mkId: number;
  name: string;
  faction: string | null;
  slug: string | null;
  isCoalition: boolean;
  /** ציון 0 עד 100 לכל היגד לפי issueId; היגד חסר = 0 */
  cells: Record<string, number>;
  active: number;
  median: number;
  total: number;
  rank: number;
  photo: string | null;
}

interface Summary {
  statementCount: number;
  minActive: number;
  rows: SummaryRow[];
}

/**
 * שמות סיעה לתצוגה. השם הרשמי במאגר ארוך ("התאחדות הספרדים שומרי תורה
 * תנועתו של מרן הרב עובדיה יוסף זצ"ל"), ובכרטיס הוא דוחק את כל השאר.
 */
const FACTION_SHORT: Record<string, string> = {
  'התאחדות הספרדים שומרי תורה תנועתו של מרן הרב עובדיה יוסף זצ"ל': 'ש"ס',
  'כחול לבן - המחנה הממלכתי': 'המחנה הממלכתי',
  "הציונות הדתית בראשות בצלאל סמוטריץ'": 'הציונות הדתית',
  'עוצמה יהודית בראשות איתמר בן גביר': 'עוצמה יהודית',
  'נעם - בראשות אבי מעוז': 'נעם',
};

function shortFaction(name: string | null): string {
  if (!name) return 'ללא סיעה';
  const trimmed = name.trim();
  return FACTION_SHORT[trimmed] ?? trimmed;
}

const total = (c: StageCounts) => c.filed + c.advanced + c.law;
const votesTotal = (c: FactionCounts) => c.withFaction + c.againstFaction;
/**
 * קנה המידה של הפסים: סך כל ההצעות בהיגד וסך כל ההצבעות בהיגד. הפס של
 * ח"כ מראה איזה חלק מהפעילות בנושא הוא שלו, לא כמה הוא ביחס לשני. מוביל
 * עם 45 מתוך 516 הצעות מקבל פס קצר, וזה נכון: הנושא גדול ממנו.
 * (הערה: הצעה יכולה להיות חתומה על ידי כמה ח"כים, ולכן חלקי כל הח"כים
 * יחד עולים על 100%.)
 */
interface BarScale { bills: number; votes: number }
const statementScale = (st: StatementResult): BarScale => ({
  bills: Math.max(1, st.billCount),
  votes: Math.max(1, st.voteCount),
});

/* ───────────────────────────── רכיבי מסך התוצאות ───────────────────────────── */

/**
 * כפתור אקורדיון: ריבוע מעוגל, אייקון בלבד, בלי רקע. בריחוף הרקע מתכהה
 * מעט ביחס לכרטיס (דיו ב-8%), כך שהוא עובד על הזהוב ועל הכחול כאחד.
 */
function AccordionButton({ open, onClick, controls, label }: { open: boolean; onClick: () => void; controls: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      className="w-7 h-7 rounded-control inline-flex items-center justify-center text-ink-2 hover:bg-ink/10 hover:text-ink transition-colors shrink-0"
    >
      <Chevron open={open} />
    </button>
  );
}

/** חץ קטן לאקורדיון, מסתובב כשפתוח */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
      <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * שני המדדים, פס אחד לכל מדד, וכפתור אקורדיון ליד כל פס שפותח את הפירוט
 * המלא של אותו מדד (כל ההצעות, או כל ההצבעות). ככה הפירוט יושב ליד מה
 * שהוא מסביר, ואין רשימות נפרדות בתחתית הכרטיס.
 *
 * שורת כותרת: שם המדד מימין, המספרים והכפתור משמאל. מתחתיה הפס: אורכו =
 * סך הפעילות ביחס לפעיל ביותר מבין המוצגים (קנה מידה נפרד לכל מדד),
 * והחלוקה בתוכו ירוק מימין ואדום משמאל.
 */
function PushBars({ l, max }: { l: Leader; max: BarScale }) {
  const [open, setOpen] = useState<{ bills: boolean; votes: boolean }>({ bills: false, votes: false });
  // שתי הרשימות באותו סדר: קודם מה שדחף לכיוון השני (מעט פריטים, והם
  // אלה שמסבירים למה הציון לא גבוה יותר, אז לא קוברים אותם בסוף רשימה
  // ארוכה), ואז מה שדחף בכיוון שלך. בתוך כל קבוצה לפי שלב ההצעה: חוק,
  // עברה טרומית, הוגשה, נעצרה. בהצבעות, באותו שלב, החדשה קודם.
  const bills = [...l.billsAgainstRefs.map(b => ({ b, against: true })), ...l.bills.map(b => ({ b, against: false }))]
    .sort((x, y) => Number(y.against) - Number(x.against) || stageRank(x.b.statusId) - stageRank(y.b.statusId));
  const votes = [...l.votes]
    .sort((x, y) => Number(!y.supportive) - Number(!x.supportive) || stageRank(x.statusId) - stageRank(y.statusId) || y.date.localeCompare(x.date));
  const rows: Array<{ key: 'bills' | 'votes'; title: string; forN: number; againstN: number; scale: number; count: number; countLabelText: string }> = [
    { key: 'bills', title: 'מדד היוזמה', forN: total(l.billsFor), againstN: total(l.billsAgainst), scale: max.bills, count: bills.length, countLabelText: countLabel(bills.length, 'הצעת חוק אחת', 'הצעות חוק') },
    { key: 'votes', title: 'מדד ההצבעות', forN: votesTotal(l.votesFor), againstN: votesTotal(l.votesAgainst), scale: max.votes, count: l.votes.length, countLabelText: countLabel(l.votes.length, 'הצבעה אחת', 'הצבעות') },
  ];
  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {rows.map(r => {
        const sum = r.forN + r.againstN;
        // רצפה של 1.5% כדי שפעילות קטנה בהיגד גדול עדיין תיראה
        const length = sum > 0 ? Math.min(100, Math.max(1.5, (100 * sum) / r.scale)) : 0;
        const isOpen = open[r.key];
        const panelId = `${r.key}-${l.mkId}`;
        return (
          <div key={r.key}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-ui font-medium text-ink">{r.title}</span>
              <span className="flex items-center gap-2 text-meta font-medium tabular-nums">
                <span className="text-pass">{r.forN} בכיוון שלך</span>
                <span className="text-mute">·</span>
                <span className={r.againstN > 0 ? 'text-fail' : 'text-mute'}>{r.againstN} לכיוון השני</span>
              </span>
            </div>
            {/* הפס, ובקצהו השמאלי כפתור האקורדיון: אייקון בלבד, בלי טקסט */}
            <div className="mt-1.5 flex items-center gap-2">
              <div className="relative flex-1 h-2.5 rounded-full bg-line/60" role="img" aria-label={`${r.title}: ${r.forN} בכיוון שלך, ${r.againstN} לכיוון השני`}>
                {sum > 0 && (
                  <div className="absolute inset-y-0 right-0 flex gap-0.5" style={{ width: `${length}%` }}>
                    {r.forN > 0 && <div className="h-full rounded-full bg-pass" style={{ width: `${(100 * r.forN) / sum}%` }} />}
                    {r.againstN > 0 && <div className="h-full rounded-full bg-fail" style={{ width: `${(100 * r.againstN) / sum}%` }} />}
                  </div>
                )}
              </div>
              {r.count > 0 && (
                <AccordionButton
                  open={isOpen}
                  onClick={() => setOpen(o => ({ ...o, [r.key]: !o[r.key] }))}
                  controls={panelId}
                  label={isOpen ? `לסגור את ${r.countLabelText}` : `להציג ${r.countLabelText}`}
                />
              )}
            </div>
            {isOpen && (
              <ul id={panelId} className="mt-2 mb-1 flex flex-col gap-1.5 text-meta rounded-control bg-surface/70 px-3 py-2">
                {r.key === 'bills'
                  ? bills.map(x => <BillRow key={x.b.billId} bill={x.b} against={x.against} />)
                  : votes.map(v => <VoteRow key={v.voteId} v={v} />)}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * סדר אחיד לשתי הרשימות: קודם לכיוון השני (המידע המפתיע), אחר כך בכיוון
 * שלך; בתוך כל קבוצה לפי השלב (הפכה לחוק, עברה טרומית, הוגשה, נעצרה);
 * ובהצבעות, בתוך אותו שלב, מהחדש לישן.
 */
const STAGE_ORDER: Record<string, number> = { passed: 0, advanced: 1, pending: 2, stopped: 3 };
const stageRank = (statusId: number | null) => (statusId === null ? 4 : STAGE_ORDER[billStageLabel(statusId).tone] ?? 4);

/** שורה אחת, זהה בשתי הרשימות: לאן זה דוחף, שם ההצעה כקישור, תג סוג (ממשלתית / של ועדה), והשלב שלה */
function EvidenceRow({ against, href, title, statusId, note, tag }: { against: boolean; href: string; title: string; statusId: number | null; note?: string; tag?: string }) {
  return (
    <li className="grid grid-cols-[auto_1fr_auto] gap-x-2 items-start">
      <span className={`shrink-0 font-medium ${against ? 'text-fail' : 'text-pass'}`}>{against ? 'לכיוון השני' : 'בכיוון שלך'}</span>
      <span className="min-w-0">
        <Link href={href} className="text-ink hover:underline underline-offset-2">{title}</Link>
        {tag && <span className="ms-1.5 align-middle rounded px-1 py-px text-[10px] font-medium bg-line text-ink-2">{tag}</span>}
        {note && <span className="text-ink font-medium"> · {note}</span>}
      </span>
      <span className="shrink-0 text-mute">{statusId !== null ? billStageLabel(statusId).label : ''}</span>
    </li>
  );
}

function BillRow({ bill, against }: { bill: BillRef; against: boolean }) {
  const tag = bill.kind === 'government' ? 'ממשלתית' : bill.kind === 'committee' ? 'של הוועדה' : undefined;
  return <EvidenceRow against={against} href={`/bill/${bill.billId}`} title={bill.title} statusId={bill.statusId} tag={tag} note={bill.viaChair ? 'כיו"ר הוועדה' : undefined} />;
}

/**
 * הצבעה: הכיוון הוא התוצאה (הצבעה נגד הצעה לכיוון השני = בכיוון שלך),
 * ולכן ליד השם כתובה ההצבעה בפועל (שם עצם ולא פועל: במאגר אין מין של
 * הח"כ, ו"הצבעה בעד" פונה לכולם). "נגד הסיעה" מצוין רק כשקרה, כי זה
 * נדיר וחשוב; "עם הסיעה" הוא ברירת המחדל ואינו נכתב.
 */
function VoteRow({ v }: { v: VoteRef }) {
  const note = `הצבעה ${v.votedFor ? 'בעד' : 'נגד'}${v.withFaction === false ? ', נגד הסיעה' : ''}`;
  return <EvidenceRow against={!v.supportive} href={`/vote/${v.voteId}`} title={v.title} statusId={v.statusId} note={note} tag={v.government ? 'ממשלתית' : undefined} />;
}

/**
 * משקלי המודל, לתצוגת החישוב בלבד. המספר שקובע יושב במנוע (PUSH_WEIGHTS
 * ב-agenda-activity.ts), שאי אפשר לייבא לרכיב לקוח כי הוא מושך את מסד
 * הנתונים. אם משנים שם, משנים גם כאן.
 */
const WEIGHTS = { filed: 1, advanced: 2, law: 4, voteWith: 0.25, voteAgainst: 1 } as const;

/**
 * טולטיפ. נפתח בריחוף ובמיקוד מקלדת (זמני) ובלחיצה (נעוץ, למובייל).
 * ה-trigger הוא כפתור אמיתי עם aria-describedby, והתוכן ב-role=tooltip.
 */
function Tip({ id, content, children, className = '', align = 'start' }: { id: string; content: React.ReactNode; children: React.ReactNode; className?: string; align?: 'start' | 'end' }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  return (
    <span className={`relative inline-flex ${className}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        onClick={() => setPinned(p => !p)}
        onFocus={() => setHover(true)}
        onBlur={() => { setHover(false); setPinned(false); }}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="inline-flex items-center rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-lit"
      >
        {children}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full mt-1.5 z-20 w-80 max-w-[88vw] rounded-control border border-line bg-surface p-3 text-meta text-ink-2 leading-relaxed shadow-sm text-right font-normal ${
            /* הציון יושב בקצה השמאלי של הכרטיס, אז הפאנל שלו נפתח ימינה (left-0) ולא נחתך */
            align === 'end' ? 'left-0' : 'right-0'
          }`}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/**
 * אגודל למעלה או למטה, ל"בעד / נגד" בכפתורי השאלון ובתג שבכרטיס התוצאה.
 * מלא (fill) ולא קו, לפי בקשתה. הגאומטריה לפי Material Icons (רישיון Apache 2.0):
 * כף היד והשרוול כשני גושים עם רווח ביניהם, כמו אייקון לייק מוכר.
 */
function ThumbIcon({ up, className = '' }: { up: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      {up ? (
        <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
      ) : (
        <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" />
      )}
    </svg>
  );
}

/** כפתור i קטן, לשימוש בתוך Tip */
function InfoGlyph() {
  return (
    <span className="w-3.5 h-3.5 rounded-full border border-mute text-mute text-[9px] leading-none font-medium inline-flex items-center justify-center" aria-label="הסבר">
      i
    </span>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** מקטע אחד בפס הנקודות: מאיפה הנקודות הגיעו, כמה, ובאיזה גוון */
interface Segment { key: string; label: string; count: number; each: number; points: number; tone: string }

function segmentsOf(bills: StageCounts, votes: FactionCounts, against: boolean): Segment[] {
  const t = against
    ? { filed: 'bg-fail/35', advanced: 'bg-fail/60', law: 'bg-fail', vw: 'bg-fail/20', va: 'bg-fail/80' }
    : { filed: 'bg-pass/35', advanced: 'bg-pass/60', law: 'bg-pass', vw: 'bg-pass/20', va: 'bg-pass/80' };
  return [
    { key: 'filed', label: 'הצעות חוק שהוגשו', count: bills.filed, each: WEIGHTS.filed, points: bills.filed * WEIGHTS.filed, tone: t.filed },
    { key: 'advanced', label: 'עברו קריאה טרומית', count: bills.advanced, each: WEIGHTS.advanced, points: bills.advanced * WEIGHTS.advanced, tone: t.advanced },
    { key: 'law', label: 'הפכו לחוק', count: bills.law, each: WEIGHTS.law, points: bills.law * WEIGHTS.law, tone: t.law },
    { key: 'vw', label: 'הצבעות עם הסיעה', count: votes.withFaction, each: WEIGHTS.voteWith, points: votes.withFaction * WEIGHTS.voteWith, tone: t.vw },
    { key: 'va', label: 'הצבעות נגד הסיעה', count: votes.againstFaction, each: WEIGHTS.voteAgainst, points: votes.againstFaction * WEIGHTS.voteAgainst, tone: t.va },
  ].filter(x => x.count > 0);
}

/** פס נקודות מקוטע + מקרא: כל מקטע הוא מקור נקודות, רוחבו לפי הנקודות */
function PointsBar({ title, segments, totalPts, scale, titleTone }: { title: string; segments: Segment[]; totalPts: number; scale: number; titleTone: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex justify-between items-baseline">
        <span className={`font-medium ${titleTone}`}>{title}</span>
        <span className="font-medium text-ink tabular-nums">{fmt(totalPts)} נק׳</span>
      </span>
      <span className="flex h-2.5 w-full gap-px" aria-hidden="true">
        {segments.map(sg => (
          <span key={sg.key} className={`h-full rounded-sm ${sg.tone}`} style={{ width: `${(100 * sg.points) / scale}%` }} />
        ))}
      </span>
      {segments.length === 0 && <span className="text-mute">כלום</span>}
      {segments.map(sg => (
        <span key={sg.key} className="flex items-center gap-1.5 text-ink-2">
          <span className={`w-2 h-2 rounded-sm shrink-0 ${sg.tone}`} aria-hidden="true" />
          <span className="flex-1">
            {sg.count} {sg.label} <span className="text-mute">× {fmt(sg.each)}</span>
          </span>
          <span className="tabular-nums">{fmt(sg.points)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * ההסבר של ציון אחד, כמסך קטן: שני פסי נקודות (בכיוון שלך, לכיוון השני)
 * ופס ההשוואה למוביל. כל מספר בכרטיס ניתן לשחזור מכאן.
 */
function ScoreTipContent({ l, leaderNet, isLeader }: { l: Leader; leaderNet: number; isLeader: boolean }) {
  const forSeg = segmentsOf(l.billsFor, l.votesFor, false);
  const againstSeg = segmentsOf(l.billsAgainst, l.votesAgainst, true);
  const forPts = forSeg.reduce((a, x) => a + x.points, 0);
  const againstPts = againstSeg.reduce((a, x) => a + x.points, 0);
  const net = Math.max(0, forPts - againstPts);
  const scale = Math.max(forPts, againstPts, 1);
  return (
    <span className="flex flex-col gap-3">
      <span className="font-medium text-ink text-ui">למה {l.score}?</span>
      <PointsBar title="בכיוון שלך" segments={forSeg} totalPts={forPts} scale={scale} titleTone="text-pass" />
      <PointsBar title="לכיוון השני" segments={againstSeg} totalPts={againstPts} scale={scale} titleTone="text-fail" />
      <span className="flex flex-col gap-1 border-t border-line pt-2">
        <span className="flex justify-between items-baseline">
          <span className="font-medium text-ink">נטו: {fmt(forPts)} פחות {fmt(againstPts)}</span>
          <span className="font-medium text-ink tabular-nums">{fmt(net)} נק׳</span>
        </span>
        <span className="flex h-2.5 w-full rounded-full bg-line overflow-hidden" aria-hidden="true">
          <span className="h-full bg-ink rounded-full" style={{ width: `${Math.min(100, (100 * net) / Math.max(leaderNet, 1))}%` }} />
        </span>
        <span className="text-ink-2">
          {isLeader
            ? `הנטו הגבוה ביותר בהיגד הזה, ולכן 100. כל השאר נמדדים ביחס אליו.`
            : `${fmt(net)} מתוך ${fmt(leaderNet)} של המקום הראשון בהיגד = ${l.score}.`}
        </span>
      </span>
    </span>
  );
}

/** הפונט של הדרגה והציון: Fredoka, נטען ב-layout.tsx רק בשביל המסך הזה */
const DISPLAY_FONT = 'var(--font-fredoka), Heebo, sans-serif';

/**
 * סימון הדרגה ליד התמונה: גביע עם "1" למוביל, מדליות כסף וארד לשני
 * ולשלישי. SVG בתוך הקובץ, כי אין ספריית אייקונים בפרויקט. צבעי המתכות
 * הם בכוונה מחוץ למערכת הצבעים: סימון דרגה, לא מצב.
 */
function RankIcon({ place, mkId }: { place: 1 | 2 | 3; mkId: number }) {
  if (place === 1) {
    const gid = `gold-${mkId}`;
    return (
      <svg viewBox="0 0 176 128" width="46" height="33" role="img" aria-label="מקום ראשון" className="shrink-0">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F8DC7A" />
            <stop offset="0.5" stopColor="#E3B53D" />
            <stop offset="1" stopColor="#B07E22" />
          </linearGradient>
        </defs>
        <ellipse cx="88" cy="122" rx="38" ry="4.5" fill="#0D1B2A" opacity="0.12" />
        <path d="M46 40 C 22 40, 20 76, 48 76" fill="none" stroke="#6B4F10" strokeWidth="11" strokeLinecap="round" />
        <path d="M46 40 C 22 40, 20 76, 48 76" fill="none" stroke="#E3B53D" strokeWidth="6" strokeLinecap="round" />
        <path d="M130 40 C 154 40, 156 76, 128 76" fill="none" stroke="#6B4F10" strokeWidth="11" strokeLinecap="round" />
        <path d="M130 40 C 154 40, 156 76, 128 76" fill="none" stroke="#E3B53D" strokeWidth="6" strokeLinecap="round" />
        <rect x="78" y="94" width="20" height="12" fill="#B07E22" stroke="#6B4F10" strokeWidth="3" strokeLinejoin="round" />
        <rect x="62" y="104" width="52" height="9" rx="3" fill="#E3B53D" stroke="#6B4F10" strokeWidth="3" />
        <rect x="54" y="111" width="68" height="10" rx="4" fill="#8A6615" stroke="#6B4F10" strokeWidth="3" />
        <path d="M46 24 H130 V56 C 130 82, 110 96, 88 96 C 66 96, 46 82, 46 56 Z" fill={`url(#${gid})`} stroke="#6B4F10" strokeWidth="3.5" strokeLinejoin="round" />
        <rect x="41" y="18" width="94" height="12" rx="6" fill="#F3CF5C" stroke="#6B4F10" strokeWidth="3.5" />
        <path d="M54 36 H66 V60 C 66 70, 62 76, 58 78 C 54 72, 52 56, 54 36 Z" fill="#FFFFFF" opacity="0.5" />
        <text x="88" y="80" textAnchor="middle" fontSize="48" fontWeight="700" style={{ fontFamily: DISPLAY_FONT }} fill="#6B4F10" opacity="0.55">1</text>
        <text x="88" y="78" textAnchor="middle" fontSize="48" fontWeight="700" style={{ fontFamily: DISPLAY_FONT }} fill="#FFFFFF" stroke="#6B4F10" strokeWidth="2" paintOrder="stroke">1</text>
      </svg>
    );
  }
  const fill = place === 2 ? '#A3ADB8' : '#B87333';
  const dark = place === 2 ? '#6E7781' : '#7E4B1C';
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-label={place === 2 ? 'מקום שני' : 'מקום שלישי'} role="img" className="shrink-0">
      <path d="M8 2h3l1 4 1-4h3l-2.5 7h-3L8 2z" fill={fill} opacity="0.7" />
      <circle cx="12" cy="15" r="6.5" fill={fill} stroke={dark} strokeWidth="1" />
      <text x="12" y="18.4" textAnchor="middle" fontSize="9" fontWeight="700" style={{ fontFamily: DISPLAY_FONT }} fill="#FFFFFF">{place}</text>
    </svg>
  );
}

/**
 * הציון בהיגד: גדול, שמן, בגוון כהה של צבע הכרטיס (נייבי לקואליציה,
 * זהב כהה לאופוזיציה), ומתחתיו "איך חישבנו?" שפותח את טולטיפ החישוב.
 */
function ScoreMark({ l, leaderNet, isLeader, tipKey }: { l: Leader; leaderNet: number; isLeader: boolean; tipKey: string }) {
  return (
    <Tip id={`score-${l.mkId}-${tipKey}`} align="end" content={<ScoreTipContent l={l} leaderNet={leaderNet} isLeader={isLeader} />} className="shrink-0">
      <span className="flex flex-col items-center leading-none">
        <span
          className={`text-[30px] font-bold tabular-nums ${l.isCoalition ? 'text-navy' : 'text-accent-ink'}`}
          style={{ fontFamily: DISPLAY_FONT }}
        >
          {l.score}
        </span>
        <span className="mt-1 text-meta text-mute underline underline-offset-2 decoration-dotted">איך חישבנו?</span>
      </span>
    </Tip>
  );
}

function LeaderTags({ l }: { l: Leader }) {
  return (
    <>
      {l.isMinister && <span className="text-meta font-medium px-1.5 py-0.5 rounded bg-line text-ink-2">שר/ה</span>}
      {l.isFormer && (
        <span className="text-meta font-medium px-1.5 py-0.5 rounded bg-warn-wash text-warn">
          {l.tenureEnd ? `כהונה עד ${formatMonth(l.tenureEnd)}` : 'כהונה הסתיימה'}
        </span>
      )}
    </>
  );
}

/** המוביל בהיגד: אותו מבנה שורה כמו השניים שאחריו, רק גדול יותר ופתוח */
function LeaderBlock({ l, max, leaderNet }: { l: Leader; max: BarScale; leaderNet: number }) {
  return (
    <div className={`rounded-control p-3 ${l.isCoalition ? 'bg-navy-wash' : 'bg-accent-wash'}`}>
      {/*
        גריד ולא flex: בטלפון (מתחת ל-sm) הציון יורד לשורה שנייה, בעמודת
        הטקסט מתחת לשם, כדי שהשם והסיעה יקבלו את כל הרוחב ולא יישברו לשלוש
        שורות. מרוחב sm הכול בשורה אחת: אייקון, תמונה, טקסט, ציון.
      */}
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
        <RankIcon place={1} mkId={l.mkId} />
        <MkAvatar name={l.name} photo={l.photo} isCoalition={l.isCoalition} size="lg" />
        <div className="min-w-0">
          <p className="text-meta font-medium text-accent-ink" style={{ fontFamily: DISPLAY_FONT }}>
            הפעילות הרבה ביותר בכיוון שלך
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-body font-medium">
              <Link href={`/mk/${l.slug ?? l.mkId}`} className="hover:underline underline-offset-2">{l.name}</Link>
            </h4>
            <LeaderTags l={l} />
          </div>
          <p className="text-meta text-mute font-medium">{shortFaction(l.faction)} · {l.isCoalition ? 'קואליציה' : 'אופוזיציה'}</p>
        </div>
        <div className="col-start-3 sm:col-start-auto justify-self-start">
          <ScoreMark l={l} leaderNet={leaderNet} isLeader={l.rank === 1} tipKey="lead" />
        </div>
      </div>
      <PushBars l={l} max={max} />
    </div>
  );
}

/** המקומות השני והשלישי: אותו מבנה שורה כמו המוביל, והאקורדיון פותח את המדדים */
function RunnerUp({ l, place, open, onToggle, leaderNet, max }: { l: Leader; place: 2 | 3; open: boolean; onToggle: () => void; leaderNet: number; max: BarScale }) {
  const panelId = `measures-${l.mkId}`;
  return (
    <li className={`rounded-control px-3 py-2.5 ${l.isCoalition ? 'bg-navy-wash' : 'bg-accent-wash'}`}>
      {/* אותו גריד כמו אצל המוביל: בטלפון הציון והאקורדיון יורדים לשורה שנייה מתחת לשם */}
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-2">
        <RankIcon place={place} mkId={l.mkId} />
        <MkAvatar name={l.name} photo={l.photo} isCoalition={l.isCoalition} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-body font-medium">
              <Link href={`/mk/${l.slug ?? l.mkId}`} className="hover:underline underline-offset-2">{l.name}</Link>
            </span>
            <LeaderTags l={l} />
          </div>
          <p className="text-meta text-mute font-medium">{shortFaction(l.faction)} · {l.isCoalition ? 'קואליציה' : 'אופוזיציה'}</p>
        </div>
        <div className="col-start-3 sm:col-start-auto flex items-start gap-2.5">
          <ScoreMark l={l} leaderNet={leaderNet} isLeader={false} tipKey={String(place)} />
          <AccordionButton open={open} onClick={onToggle} controls={panelId} label={open ? 'לסגור את המדדים' : 'להציג את המדדים'} />
        </div>
      </div>
      {open && (
        <div id={panelId} className="mt-1">
          <PushBars l={l} max={max} />
        </div>
      )}
    </li>
  );
}

/** צ'יפ משקל: נקודת גוון, תווית, והמספר בפונט התצוגה */
function WeightChip({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-control border border-line bg-paper px-2 py-1 text-meta font-medium text-ink-2">
      <span className={`w-2 h-2 rounded-sm shrink-0 ${tone}`} aria-hidden="true" />
      {label}
      <span className="text-ink text-[13px] font-bold tabular-nums" style={{ fontFamily: DISPLAY_FONT }}>{fmt(value)}</span>
    </span>
  );
}

/**
 * "איך מחושב הציון?" בראש התוצאות: העיקרון במשפט, שני המדדים זה לצד זה
 * עם המשקלים כצ'יפים (אותם גוונים כמו בטולטיפ של כל ציון), ומה לא נספר
 * ולמה. פתוח תמיד: זה החוזה עם הקוראת, לא הערת שוליים. המשקלים מגיעים
 * מ-WEIGHTS, אותו מקור כמו הטולטיפים, כדי שלא יסתרו.
 */
function ScoreExplainer() {
  return (
    <section aria-labelledby="score-explainer-heading" className="rounded-card border border-line bg-surface p-4 mb-4">
      <h3 id="score-explainer-heading" className="text-body font-medium">איך מחושב הציון?</h3>
      <p className="mt-1 text-meta text-ink-2 leading-relaxed">
        לכל היגד ספרנו, לכל ח&quot;כ, את הפעילות בכיוון שבחרת פחות הפעילות לכיוון השני. הפעילות הגבוהה ביותר בהיגד היא 100, וכל השאר
        נמדדים ביחס אליה. כל פריט נספר לצד שאליו הוא דוחף בפועל: הצבעה נגד הצעה לכיוון השני היא פעולה בכיוון שלך.
      </p>
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <div className="rounded-control bg-paper/60 border border-line p-3">
          <h4 className="text-ui font-medium text-ink">מדד היוזמה</h4>
          <p className="mt-1 text-meta text-ink-2 leading-relaxed">
            הצעות חוק שהח&quot;כ חתום עליהן כיוזם. ככל שההצעה התקדמה היא שווה יותר, כי רוב ההצעות הפרטיות נעצרות בהתחלה:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <WeightChip tone="bg-pass/35" label="הוגשה" value={WEIGHTS.filed} />
            <WeightChip tone="bg-pass/60" label="עברה קריאה טרומית" value={WEIGHTS.advanced} />
            <WeightChip tone="bg-pass" label="הפכה לחוק" value={WEIGHTS.law} />
          </div>
        </div>
        <div className="rounded-control bg-paper/60 border border-line p-3">
          <h4 className="text-ui font-medium text-ink">מדד ההצבעות</h4>
          <p className="mt-1 text-meta text-ink-2 leading-relaxed">
            הצבעות במליאה על הצעות בהיגד. כמעט כל הצבעה היא עם הסיעה, ולכן היא אומרת מעט על הח&quot;כ. הצבעה נגד הסיעה היא
            החלטה אישית, ושווה כמו הצעת חוק:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <WeightChip tone="bg-pass/20" label="עם הסיעה" value={WEIGHTS.voteWith} />
            <WeightChip tone="bg-pass/80" label="נגד הסיעה" value={WEIGHTS.voteAgainst} />
          </div>
        </div>
      </div>
      <p className="mt-3 text-meta text-mute leading-relaxed">
        הצעות ממשלתיות נספרות בהצבעות ובסך ההיגד, לא ביוזמה: במאגר אין מי במשרד יזם אותן. הצעות של ועדה נזקפות ליו&quot;ר הוועדה.{' '}
        <Link href="/did-you-know" className="font-medium text-accent hover:underline">למה שרים כמעט לא מופיעים כאן ←</Link>
      </p>
    </section>
  );
}

/**
 * שורת הממשלה בפאנל הכיוון: כמה מההצעות בכיוון הזה הן ממשלתיות וכמה מהן
 * הפכו לחוק. זה מה שמאזן את הטיית היוזמה הפרטית: רוב החוקים שעוברים הם
 * ממשלתיים, והם לא נזקפים לאף ח"כ כיוזמה כי אין במאגר מי במשרד יזם אותם.
 */
function GovLine({ g }: { g: { bills: number; laws: number } }) {
  if (g.bills === 0) return null;
  const laws = g.laws === 0 ? '' : g.laws === 1 ? ', אחת הפכה לחוק' : `, ${g.laws} הפכו לחוק`;
  return <span className="mt-1 block text-mute">מהן {countLabel(g.bills, 'הצעה ממשלתית אחת', 'ממשלתיות')}{laws}</span>;
}

/** חמש מדרגות לתא ברשת: ריק, ואז ארבעה גוונים של ירוק לפי הציון */
function cellTone(score: number | null): string {
  if (score === null) return 'text-mute';
  if (score === 0) return 'bg-line/40';
  if (score < 25) return 'bg-pass/15 text-ink';
  if (score < 50) return 'bg-pass/35 text-ink';
  if (score < 75) return 'bg-pass/65 text-white';
  return 'bg-pass text-white';
}

/** סימון המקום בעשירייה: גביע ומדליות ל-1 עד 3 (כמו בכרטיסים), מספר לשאר */
function PlaceMark({ rank, mkId }: { rank: number; mkId: number }) {
  if (rank <= 3) return <RankIcon place={rank as 1 | 2 | 3} mkId={mkId} />;
  return (
    <span className="w-7 h-7 rounded-full bg-surface-2 text-ink-2 text-[13px] font-bold inline-flex items-center justify-center tabular-nums" style={{ fontFamily: DISPLAY_FONT }}>
      {rank}
    </span>
  );
}

/**
 * העשירייה העקבית, כפודיום: שורה לח"כ לפי המקום, עמודה לכל היגד (ממוספר
 * כמו הכרטיסים שלמטה), ובכל תא הציון של אותו היגד. בסוף השורה החציון,
 * שלפיו הסדר, ומתחתיו בכמה היגדים יש פעילות. שלושת הראשונים צבועים בגוון
 * המחנה שלהם, כמו כרטיסי הפודיום בהיגדים; השאר על רקע הכרטיס.
 *
 * למה רשת ולא מספר אחד: המספר לבדו היה קופסה שחורה. ברשת רואים את
 * הדפוס בעצמך: רצף של 30 עד 40 מול 100 ואפסים. כשיש הרבה היגדים הרשת
 * נגללת לרוחב, ועמודת השם והחציון נשארות במקום (sticky).
 */
function ConsistencyGrid({ summary, statements, counted }: { summary: Summary; statements: Array<{ issueId: string; question: string }>; counted: Set<string> }) {
  if (summary.statementCount < 2) return null;
  const rows = summary.rows;
  const wash = (r: SummaryRow) => (r.rank <= 3 ? (r.isCoalition ? 'bg-navy-wash' : 'bg-accent-wash') : 'bg-surface');
  return (
    <section aria-labelledby="consistent-heading" className="rounded-card border border-line bg-surface p-4 mb-4">
      <div className="flex items-center gap-1.5">
        <h3 id="consistent-heading" className="text-body font-medium">עקביים לאורך ההיגדים</h3>
        <Tip
          id="consistent-tip"
          content={
            <span className="flex flex-col gap-1">
              <span className="font-medium text-ink">מי נכנסים, ומה הסדר</span>
              <span>נכנסים ח&quot;כים שפעלו בכיוון שלך בלפחות חצי מההיגדים שענית. היגד שאף אחד לא פעל בו בכיוון שלך לא נספר.</span>
              <span>הסדר לפי החציון: הציון שמגיעים אליו בחצי מההיגדים לפחות. ציון גבוה בהיגד אחד לא מרים אותו, והיעדרות מהיגד אחד לא מפילה אותו. בשוויון מכריע סך הנקודות.</span>
              <span>למה לא ממוצע: 100 בהיגד קטן זו הצעה אחת, ו-100 בהיגד גדול זה עשרות. ממוצע נותן להיגדים הקטנים לשלוט.</span>
            </span>
          }
        >
          <InfoGlyph />
        </Tip>
      </div>
      <p className="mt-0.5 text-meta text-mute font-medium">
        העשירייה הראשונה מבין מי שפעלו בכיוון שלך בלפחות {summary.minActive} מתוך {summary.statementCount} היגדים. המספרים בכותרת הם מספרי ההיגדים שלמטה.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-meta text-mute">אין ח&quot;כים שפעלו בכיוון שלך בלפחות חצי מההיגדים.</p>
      ) : (
        /*
          ריפוד אנכי למכל: הטבעת של התמונה (ring) מצוירת מחוץ לקופסה, ומכל
          שגולל לרוחב חותך גם לגובה. לרוחב אין ריפוד ואין רווח בין העמודות:
          העמודות הדביקות (שם, חציון) צריכות רקע רציף, אחרת התאים שנגללים
          מתחתיהן מציצים דרך הרווחים. המרווח בין התאים הוא בתוך העמודה, וצבע
          השורה יושב על כל תא בשורה, כי לגריד אין אלמנט שורה.
        */
        <div className="mt-3 overflow-x-auto py-1.5">
          {/*
            בטלפון עמודת השם הייתה משאירה מקום לשלושה תאים בלבד, אז שם השם
            תופס שורה משלו (col-span-full) והתאים מתחתיו. מרוחב sm הכול בשורה
            אחת. מספר העמודות עובר כמשתנה CSS, כי style לא יודע media queries.
          */}
          <div
            className="grid gap-y-1 items-stretch grid-cols-[repeat(var(--cols),2rem)_auto] sm:grid-cols-[minmax(230px,auto)_repeat(var(--cols),2rem)_auto]"
            style={{ '--cols': statements.length } as React.CSSProperties}
          >
            <div className="hidden sm:block sticky right-0 z-[1] bg-surface" aria-hidden="true" />
            {statements.map((st, i) => (
              <div key={st.issueId} title={st.question} className="self-center text-center text-meta text-mute font-medium tabular-nums">
                {i + 1}
              </div>
            ))}
            <div className="sticky left-0 z-[1] bg-surface self-center text-center text-meta text-mute font-medium pl-1.5 pr-2">חציון</div>
            {rows.map(r => (
              <Fragment key={r.mkId}>
                <div className={`col-span-full sm:col-span-1 mt-1 sm:mt-0 sticky right-0 z-[1] ${wash(r)} rounded-control sm:rounded-l-none flex items-center gap-2.5 min-w-0 pr-2 pl-2 py-1.5`}>
                  <span className="w-12 shrink-0 flex items-center justify-center">
                    <PlaceMark rank={r.rank} mkId={r.mkId} />
                  </span>
                  <MkAvatar name={r.name} photo={r.photo} isCoalition={r.isCoalition} />
                  <div className="min-w-0">
                    <div className="text-ui font-medium truncate">
                      <Link href={`/mk/${r.slug ?? r.mkId}`} className="hover:underline underline-offset-2">{r.name}</Link>
                    </div>
                    <div className="text-meta text-mute font-medium truncate">{shortFaction(r.faction)} · {r.isCoalition ? 'קואליציה' : 'אופוזיציה'}</div>
                  </div>
                </div>
                {statements.map((st, i) => {
                  const score = counted.has(st.issueId) ? (r.cells[st.issueId] ?? 0) : null;
                  return (
                    <div key={st.issueId} className={`${wash(r)} flex items-center justify-center py-1.5`}>
                      <div
                        title={score === null ? `היגד ${i + 1}: אין פעילות בכיוון שלך` : `היגד ${i + 1}: ${score}`}
                        className={`h-7 w-7 rounded-sm flex items-center justify-center text-[10px] font-medium tabular-nums ${cellTone(score)}`}
                      >
                        {score === null ? '–' : score === 0 ? '' : score}
                      </div>
                    </div>
                  );
                })}
                <div className={`sticky left-0 z-[1] ${wash(r)} rounded-l-control flex flex-col items-center justify-center leading-none pl-2 pr-2 py-1.5`}>
                  <span className={`text-[22px] font-bold tabular-nums ${r.isCoalition ? 'text-navy' : 'text-accent-ink'}`} style={{ fontFamily: DISPLAY_FONT }}>
                    {Math.round(r.median)}
                  </span>
                  <span className="mt-1 text-meta text-mute tabular-nums" title="בכמה מההיגדים יש פעילות בכיוון שלך">{r.active}/{summary.statementCount}</span>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * כרטיס להיגד אחד: ההיגד, התשובה, שני הצדדים במילים, המוביל ואחריו עוד.
 * הציון של כל ח"כ הוא ביחס למוביל בין כולם, גם כשמסננים לפי מחנה, ולכן
 * המוביל של הקואליציה יכול להיות 45: זה מה שהוא דחף ביחס למוביל הכללי.
 */
function StatementCard({
  st,
  index,
  agreed,
  openKeys,
  onToggle,
}: {
  st: StatementResult;
  /** המספר של ההיגד, כמו בכותרת הרשת למעלה */
  index: number;
  agreed: boolean;
  openKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const list = [...st.leaders].sort((a, b) => a.rank - b.rank);
  const leader = list[0];
  /** מקומות שני ושלישי בלבד. השאר אינם מוצגים: זה "מי מצטיין", לא דירוג מלא */
  const podium = list.slice(1, 3);
  const max = statementScale(st);
  const unknown = st.billCount - st.billsYourSide - st.billsOtherSide;

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      {/*
        כותרת ההיגד כגוש אחד: ההיגד, מתחתיו שורת עובדות קצרה, ומתחתיה שני
        הצדדים בפאנל אחד מחולק לשניים. הצד שלך מסומן בגבול כהה ובכותרת
        מודגשת, לא בבלוק שחור: שני הצדדים הם טקסט מהקטלוג, באותו משקל.
      */}
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-surface-2 text-meta font-medium text-ink-2 inline-flex items-center justify-center tabular-nums" aria-hidden="true">
          {index}
        </span>
        <h3 className="text-body font-medium leading-snug flex-1">{st.label}</h3>
        {/* התשובה שלך, בקצה השני של הכותרת. ירוק ואדום כאן הם "בעד / נגד", הסימון מהשאלון */}
        <span
          className={`shrink-0 inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-meta font-medium ${
            agreed ? 'bg-pass-wash text-pass' : 'bg-fail-wash text-fail'
          }`}
        >
          <ThumbIcon up={agreed} className="w-3.5 h-3.5" />
          {agreed ? 'בעד' : 'נגד'}
        </span>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-meta text-mute font-medium">
        <span>
          {countLabel(st.activeMks, 'ח"כ אחד דחף', 'ח"כים דחפו')} בכיוון שלך
          {unknown > 0 && ` · ${unknown} הצעות בהיגד בלי כיוון ידוע`}
        </span>
        <Tip
          id={`active-${st.issueId}`}
          content={
            <span className="flex flex-col gap-1">
              <span className="font-medium text-ink">מי נספרים כמי שדחפו בכיוון שלך</span>
              <span>ח&quot;כים שהפעילות שלהם בכיוון שלך בהיגד הזה, הצעות חוק שהגישו והצבעות שתמכו בהן, גדולה מהפעילות שלהם לכיוון השני.</span>
              <span>אין סף: גם הצבעה אחת עם הסיעה מספיקה. לכן המספר גדול, והוא אומר &quot;נגעו בנושא&quot;, לא &quot;עבדו עליו&quot;. כמה עבדו, זה הציון.</span>
            </span>
          }
        >
          <InfoGlyph />
        </Tip>
      </p>

      {(st.yourSide || st.otherSide) && (
        <div className="mt-3 grid sm:grid-cols-2 rounded-control border border-line overflow-hidden text-meta">
          {/* ירוק ואדום: הצד שלך והצד השני, אותו סימון כמו התג "בעד / נגד" */}
          <div className="px-3 py-2.5 bg-pass-wash border-b sm:border-b-0 sm:border-l border-line">
            <div className="flex items-baseline justify-between gap-2 mb-0.5">
              <span className="font-medium text-pass">הכיוון שלך</span>
              <span className="text-mute tabular-nums"><strong className="font-bold text-ink">{st.billsYourSide}</strong>/{st.billCount} הצעות חוק</span>
            </div>
            <span className="text-ink">{st.yourSide}</span>
            <GovLine g={st.govYourSide} />
          </div>
          <div className="px-3 py-2.5 bg-fail-wash">
            <div className="flex items-baseline justify-between gap-2 mb-0.5">
              <span className="font-medium text-fail">הכיוון השני</span>
              <span className="text-mute tabular-nums"><strong className="font-bold text-ink">{st.billsOtherSide}</strong>/{st.billCount} הצעות חוק</span>
            </div>
            <span className="text-ink-2">{st.otherSide}</span>
            <GovLine g={st.govOtherSide} />
          </div>
        </div>
      )}

      {leader ? (
        <div className="mt-3">
          <LeaderBlock l={leader} max={max} leaderNet={st.leaderNet} />
        </div>
      ) : (
        <p className="mt-3 text-meta text-mute">אין ח&quot;כים שפעלו בכיוון שלך בהיגד הזה.</p>
      )}

      {podium.length > 0 && (
        <ol className="mt-2 flex flex-col gap-1.5">
          {podium.map((l, i) => (
            <RunnerUp
              key={l.mkId}
              l={l}
              place={i === 0 ? 2 : 3}
              leaderNet={st.leaderNet}
              max={max}
              open={openKeys.has(`${st.issueId}:${l.mkId}`)}
              onToggle={() => onToggle(`${st.issueId}:${l.mkId}`)}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

export default function KeywordMatchClient() {
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('topics');
  const [topics, setTopics] = useState<string[]>([]);
  const [clusters, setClusters] = useState<string[]>([]);
  const [stances, setStances] = useState<Record<string, string>>({});

  const [statementsResult, setStatementsResult] = useState<StatementResult[]>([]);
  /** הסיכום לאורך ההיגדים, מאותה בקשה */
  const [summary, setSummary] = useState<Summary | null>(null);
  /** מה פתוח: "issueId:mkId" לפרטי ח"כ, "issueId:more" לרשימה המלאה */
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
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
      .filter(id => CLUSTER_TOPICS.some(t => t.id === id));

    if (valid.length > 0) {
      setTopics(valid);
      setStep('clusters');
    }
  }, [searchParams]);

  /**
   * מעבר שלב מחזיר לראש העמוד.
   *
   * בלי זה המשתמשת נוחתת באמצע הרשימה: שלב העמדות ארוך, והדפדפן שומר
   * את מיקום הגלילה - כך שמסך התוצאות נפתח כשהמדורגים הראשונים מעליה.
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

  /**
   * ההיגדים שנענו, בסדר שבו הופיעו על המסך, עם התחום והצד שנבחר.
   * הבסיס לפירוט בכרטיס: לכל היגד כאן מחפשים מה הח"כ עשה בו.
   */
  const answeredStatements = useMemo(
    () =>
      chosenClusters.flatMap(c =>
        c.questions
          .filter(q => stances[q.issueId])
          .map(q => ({
            issueId: q.issueId,
            question: q.question,
            topic: c.topic,
            agreed: stances[q.issueId].endsWith('_pro'),
          })),
      ),
    [chosenClusters, stances],
  );

  function toggleKey(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
      // התקרה היא על ההיגדים, לא על הנושאים: נושא נכנס רק אם כל ההיגדים שלו נכנסים
      const current = prev.reduce((sum, cid) => sum + (getCluster(cid)?.questions.length ?? 0), 0);
      if (current + (getCluster(id)?.questions.length ?? 0) > MAX_STATEMENTS) return prev;
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
      const res = await fetch(`${BASE_PATH}/api/agenda-leaders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: Object.entries(stances).map(([issueId, stanceId]) => ({ issueId, stanceId })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'הבקשה נכשלה');

      setStatementsResult(json.statements ?? []);
      setSummary(json.summary ?? null);
      setOpenKeys(new Set());
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
    setStatementsResult([]);
    setSummary(null);
    setOpenKeys(new Set());
    setError(null);
  }

  function back() {
    if (step === 'results') return setStep('stances');
    if (step === 'stances') return setStep('clusters');
    if (step === 'clusters') return setStep('topics');
  }

  return (
    <div className="min-h-screen bg-paper pb-10" dir="rtl">
      {/* אותו רוחב ושוליים כמו בעמוד הבית: הסטנדרט של האתר יושב ב-PageContainer */}
      <PageContainer>
        {/*
          בלי מחוון התקדמות: "איפה אני" עונות כותרות השלבים, ו"כמה נשאר"
          עונה הפס הדביק (נבחרו 2 מתוך 3, 6 נושאים · 24 היגדים). במקומו
          הכפתור הראשי קורא לשלב הבא בשמו: לנושאים, לעמדות, לתוצאות.
        */}
        <h1 className="text-page mb-8">מי עובדים בשבילך?</h1>

        {/* ---------------------------- שלב 1 ---------------------------- */}
        {step === 'topics' && (
          <div>
            <h2 className="text-section font-medium mb-1">מה מעניין אותך?</h2>
            <p className="text-ui text-ink-2 font-medium mb-1 leading-relaxed">
              בוחרים תחום אחד או יותר. בשלב הבא יופיעו הנושאים שבתוכם, ואפשר לבחור מה מהם מדבר אליך.
            </p>
            {/* המספרים של הקטלוג, ליד הבחירה ולא בתחתית העמוד (שם הם נדחקו מתחת לפס הפעולות) */}
            <p className="text-meta text-mute font-medium mb-5">
              {CLUSTER_STATS.topics} תחומים · {CLUSTER_STATS.clusters} נושאים · {CLUSTER_STATS.questions} היגדים, שנגזרו מ-7,067 הצעות חוק
            </p>

            <div className="grid sm:grid-cols-2 gap-2.5">
              {CLUSTER_TOPICS.map(t => {
                const on = topics.includes(t.id);
                const color = TOPIC_COLOR[t.label] ?? TOPIC_FALLBACK;
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTopic(t.id)}
                    aria-pressed={on}
                    /*
                      אותו כרטיס כמו בעמוד הבית, שהוא בעצם השלב הזה: אייקון התחום
                      בקופסה, וכשנבחר, גבול ורקע בגוון התחום (ולא בזהב הכללי).
                      צבע התחום מגיע מהקוד ולכן inline; color-mix מייצר את הרקע
                      הבהיר בלי לנהל 8 גוונים נוספים.
                    */
                    style={on ? { borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 8%, var(--color-surface))` } : undefined}
                    className={`text-right px-3 py-2.5 rounded-card border-2 bg-surface transition-colors ${
                      on ? 'text-ink' : 'border-transparent hover:border-line'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        style={on ? { color, backgroundColor: `color-mix(in srgb, ${color} 14%, var(--color-surface))` } : undefined}
                        className="flex items-center justify-center w-[34px] h-[34px] shrink-0 rounded-control bg-surface-2 text-ink"
                      >
                        <DomainIcon label={t.label} className="w-6 h-6" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-ui font-medium leading-snug text-ink">{t.label}</span>
                        <span className="block text-meta text-mute mt-0.5">
                          {countLabel(t.clusters.length, 'נושא אחד', 'נושאים')} · {countLabel(t.billCount, 'הצעת חוק אחת', 'הצעות חוק')}
                        </span>
                      </span>
                      {/* הסימון נוסף לצבע ולמסגרת: צבע לבדו אינו מצב */}
                      {on && <span className="shrink-0 text-ui" style={{ color }} aria-hidden="true">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            <ActionDock
              status={topics.length === 0 ? 'בוחרים תחום אחד לפחות' : topics.length === 1 ? 'נבחר תחום אחד' : `נבחרו ${topics.length} תחומים`}
            >
              <NextButton onClick={() => setStep('clusters')} disabled={topics.length === 0}>לנושאים</NextButton>
            </ActionDock>
          </div>
        )}

        {/* ---------------------------- שלב 2 ---------------------------- */}
        {step === 'clusters' && (
          <div>
            <h2 className="text-section font-medium mb-1">אילו נושאים חשובים לך?</h2>
            <p className="text-ui text-ink-2 font-medium mb-4 leading-relaxed">
              בכל נושא יש בין {CLUSTER_STATS.questionsPerCluster.min} ל-{CLUSTER_STATS.questionsPerCluster.max} היגדים, ועונים רק על מה שנבחר. אפשר לבחור נושאים עד {MAX_STATEMENTS} היגדים
              בסך הכול, וככל שעונים על יותר, הסיכום &quot;עקביים לאורך ההיגדים&quot; אמין יותר.
            </p>

            {visibleClusters.map(({ topic, list }) => (
              <div key={topic.id} className="mb-6">
                {/*
                  הכותרת הייתה קטנה ואפורה יותר מהפריטים שתחתיה, ולכן לא
                  נקראה ככותרת. לעברית אין רישיות להישען עליהן - המשקל,
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
                    /** לא נכנס: ההיגדים שלו היו חורגים מהתקרה */
                    const full = !on && questionCount + c.questions.length > MAX_STATEMENTS;
                    return (
                      <button
                        key={c.clusterId}
                        onClick={() => toggleCluster(c.clusterId)}
                        aria-pressed={on}
                        disabled={full}
                        title={full ? `חורג מהתקרה של ${MAX_STATEMENTS} היגדים` : c.questions.map(q => q.keyword).join(' · ')}
                        className={`text-right px-3 py-2 rounded-control border transition-colors ${
                          on
                            ? 'border-accent bg-accent-wash'
                            : full
                              ? 'border-line text-mute cursor-not-allowed bg-surface opacity-50'
                              : 'border-line bg-surface hover:border-accent'
                        }`}
                      >
                        {/*
                          "בתי ספר וגיל הרך 5 היגדים" באותו גודל ובאותה שורה
                          נקרא כמשפט אחד. הספירה יורדת שורה ומתעמעמת.
                        */}
                        <span className="flex items-center gap-1.5">
                          {on && <span className="text-accent text-meta shrink-0" aria-hidden="true">✓</span>}
                          <span className="text-ui text-ink leading-snug">{c.label}</span>
                        </span>
                        <span className="block text-meta text-mute mt-0.5">
                          {countLabel(c.questions.length, 'היגד אחד', 'היגדים')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <ActionDock
              status={clusters.length === 0 ? 'בוחרים נושא אחד לפחות' : `${countLabel(clusters.length, 'נושא אחד', 'נושאים')} · ${questionCount} מתוך ${MAX_STATEMENTS} היגדים`}
              progress={{ done: questionCount, total: MAX_STATEMENTS }}
            >
              <GhostButton onClick={back}>חזרה</GhostButton>
              <NextButton onClick={() => setStep('stances')} disabled={clusters.length === 0}>לעמדות</NextButton>
            </ActionDock>
          </div>
        )}

        {/* ---------------------------- שלב 3 ---------------------------- */}
        {step === 'stances' && (
          <div>
            <h2 className="text-section font-medium mb-1">מה דעתך?</h2>
            <p className="text-ui text-ink-2 font-medium mb-6 leading-relaxed">
              אפשר לדלג על היגד שאין לך דעה לגביו. הוא פשוט לא ייספר.
            </p>

            {chosenClusters.map(cluster => (
              <div key={cluster.clusterId} className="mb-7">
                {/* אותו סגנון כותרת כמו בשלב 2: נקודת הצבע של התחום ומשקל semibold, כדי שהקבוצה תיקרא ככותרת ולא כתווית */}
                <h3 className="flex items-center gap-2 text-ui font-semibold text-ink mb-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: TOPIC_COLOR[cluster.topic] ?? TOPIC_FALLBACK }}
                    aria-hidden="true"
                  />
                  {cluster.label}
                </h3>

                <div className="flex flex-col gap-3">
                  {cluster.questions.map(q => {
                    const answeredHere = Boolean(stances[q.issueId]);
                    /*
                      ההיגד והכפתורים באותה שורה (מרוחב sm): ההיגד מימין, "בעד / נגד"
                      משמאל. קודם הכפתורים ישבו בשורה משלהם מתחת להיגד, כל כרטיס היה
                      גבוה עם שטח ריק משמאל, ותשעה היגדים תפסו ארבעה מסכים. בטלפון
                      הכפתורים עדיין יורדים שורה, כי אין מקום לשניהם ליד הטקסט.

                      המצב "נענה" נראה בגוון הכרטיס ובכפתור המלא; אין צורך בסימן נוסף.
                    */
                    return (
                      <div
                        key={q.issueId}
                        className={`rounded-card border-2 px-4 py-3 transition-colors sm:flex sm:items-center sm:gap-4 ${
                          answeredHere ? 'border-accent/40 bg-accent-wash/30' : 'border-line'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="text-ui font-medium leading-relaxed">{q.question}</h4>
                          <p className="text-meta text-mute font-medium mt-0.5">
                            {q.keyword} · {q.billCount} הצעות חוק
                          </p>
                        </div>

                        {/*
                          "בעד / נגד" ולא "מסכימה / לא מסכימה": פועל בגוף שני מחייב
                          לבחור מין, ו"בעד" פונה לכולם. זה גם מתחבר ל"הכיוון שלך"
                          במסך התוצאות. נוסח העמדות המלא נשאר בקטלוג ומשמש את
                          המנוע; הוא אינו מוצג.

                          הכפתורים אינם ירוק-אדום: pass ו-fail שמורים במערכת העיצוב
                          למצב אמיתי של חוק או הצבעה, ודעה אינה מצב כזה. ההבחנה
                          עוברת דרך אגודל למעלה או למטה ודרך accent.
                        */}
                        <div className="flex gap-2 mt-3 sm:mt-0 shrink-0" role="radiogroup" aria-label={q.question}>
                          {q.stances.map((s, si) => {
                            const on = stances[q.issueId] === s.id;
                            return (
                              <button
                                key={s.id}
                                onClick={() => pickStance(q.issueId, s.id)}
                                role="radio"
                                aria-checked={on}
                                className={`flex items-center gap-2 text-ui font-medium px-4 py-2 rounded-control border-2 transition-all ${
                                  on
                                    ? 'border-accent bg-accent text-white shadow-sm'
                                    : 'border-line bg-surface hover:border-accent hover:bg-accent-wash/40'
                                }`}
                              >
                                <ThumbIcon up={si === 0} className={`w-4 h-4 shrink-0 ${on ? 'text-white' : 'text-mute'}`} />
                                {si === 0 ? 'בעד' : 'נגד'}
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

            <ActionDock
              status={answered === 0 ? 'עונים על היגד אחד לפחות' : `${answered} מתוך ${questionCount} היגדים נענו`}
              progress={{ done: answered, total: questionCount }}
            >
              <GhostButton onClick={back}>חזרה</GhostButton>
              <NextButton onClick={run} disabled={answered === 0}>לתוצאות</NextButton>
            </ActionDock>
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

            {!loading && !error && statementsResult.length > 0 && (() => {
              const byIssue = new Map(statementsResult.map(st => [st.issueId, st]));
              return (
                <>
                  {/*
                    כותרת ומשפט פתיחה אחד, ההסבר על החישוב (ScoreExplainer),
                    ואז הרשת והכרטיסים. הפירוט המספרי של כל ציון נשאר
                    בטולטיפ "איך חישבנו?" מתחת לכל ציון.
                  */}
                  <h2 className="text-section font-medium mb-2">התוצאות, היגד אחרי היגד</h2>
                  <p className="text-ui text-ink-2 mb-4">
                    לכל היגד: מי דחפו הכי הרבה לכיוון שבחרת, ומה בדיוק עשו.{' '}
                    <span className="text-mute">ענית על {countLabel(answeredStatements.length, 'היגד אחד', 'היגדים')}.</span>
                  </p>

                  <ScoreExplainer />

                  {summary && (
                    <ConsistencyGrid
                      summary={summary}
                      statements={answeredStatements}
                      counted={new Set(statementsResult.filter(st => st.leaderNet > 0).map(st => st.issueId))}
                    />
                  )}

                  <ol className="flex flex-col gap-4">
                    {answeredStatements.map((q, i) => {
                      const st = byIssue.get(q.issueId);
                      if (!st) return null;
                      return (
                        <StatementCard
                          key={st.issueId}
                          index={i + 1}
                          st={{ ...st, label: q.question }}
                          agreed={q.agreed}
                          openKeys={openKeys}
                          onToggle={toggleKey}
                        />
                      );
                    })}
                  </ol>

                  {/* אותו פס דביק כמו בשאר השלבים, כדי שהדרך חזרה תמיד תיראה, גם באמצע רשימה ארוכה */}
                  {/*
                    הרחבה בהדרגה: "להוסיף נושאים" חוזר לבחירת התחומים עם כל מה
                    שנבחר ונענה שמור במצב, מוסיפים, ועונים רק על ההיגדים החדשים.
                    "לתוצאות" שולח את כל התשובות מחדש, ישנות וחדשות, לאותה בקשה.
                  */}
                  <ActionDock status={`ענית על ${countLabel(answeredStatements.length, 'היגד אחד', 'היגדים')}`}>
                    <GhostButton onClick={restart}>להתחיל מחדש</GhostButton>
                    <GhostButton onClick={back}>לשנות תשובות</GhostButton>
                    <NextButton onClick={() => setStep('topics')} icon="plus">להוסיף נושאים</NextButton>
                  </ActionDock>
                </>
              );
            })()}
          </div>
        )}

      </PageContainer>
    </div>
  );
}

/** "2025-07-04" → "7.2025". חודש מספיק - היום המדויק אינו מוסיף. */
function formatMonth(iso: string): string {
  const [y, m] = iso.split('-');
  return m && y ? `${Number(m)}.${y}` : iso;
}

/**
 * פס הפעולות של השאלון: כרטיס צף בתחתית החלון, לא רצועה שקופה על כל
 * הרוחב עם קו. ימין (תחילת הקריאה): המצב, למשל "נבחרו 2 תחומים" או
 * "3 מתוך 9 היגדים נענו", ומתחתיו פס התקדמות דק כשיש מה למדוד. שמאל
 * (סוף): הפעולות, חזרה כקישור רפאים וההמשך ככפתור מלא עם חץ קדימה
 * (שמאלה, כי הקריאה מימין לשמאל), כמו "לשאלון" בעמוד הבית.
 *
 * z-10: הפס יושב מעל תאים דביקים בתוך התוכן (עמודת השם והחציון ברשת,
 * שמקבלות z קטן כדי לכסות תאים שנגללים). bottom-4 משאיר אותו צף מעל
 * קצה החלון במקום להיצמד אליו.
 */
function ActionDock({ status, progress, children }: { status: React.ReactNode; progress?: { done: number; total: number }; children: React.ReactNode }) {
  return (
    <div className="sticky bottom-4 z-10 mt-8 rounded-card border border-line bg-surface shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
      <div className="min-w-0 flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink-2">{status}</span>
        {progress && progress.total > 0 && (
          <span
            className="block h-1 w-36 max-w-full rounded-full bg-line overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.min(100, (100 * progress.done) / progress.total)}%` }} />
          </span>
        )}
      </div>
      <div className="ms-auto flex items-center gap-1.5">{children}</div>
    </div>
  );
}

/** כפתור ההמשך: מלא, עם חץ קדימה (שמאלה) או פלוס להוספה */
function NextButton({ onClick, disabled = false, icon = 'arrow', children }: { onClick: () => void; disabled?: boolean; icon?: 'arrow' | 'plus'; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-control bg-navy px-5 py-2.5 text-ui font-semibold text-white hover:bg-navy-deep transition-colors disabled:bg-surface-2 disabled:text-mute disabled:cursor-not-allowed"
    >
      {children}
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icon === 'arrow' ? (
          <>
            <path d="M10 15.8333L4.16667 10L10 4.16667" />
            <path d="M15.8333 10H4.16667" />
          </>
        ) : (
          <>
            <path d="M10 4.5v11" />
            <path d="M4.5 10h11" />
          </>
        )}
      </svg>
    </button>
  );
}

/** פעולה משנית: בלי מסגרת, רקע עדין בריחוף, חץ קטן אחורה (ימינה) */
function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-control px-3 py-2.5 text-ui font-medium text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
    >
      {children}
    </button>
  );
}
