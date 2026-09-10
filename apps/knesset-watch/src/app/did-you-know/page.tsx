import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'הידעת? · אפרכסת לכנסת',
  description: 'למה הנתונים נראים כפי שהם נראים, ומה אפשר ללמוד מהם',
};

/**
 * הידעת? — מה הנתונים אומרים, ומה הם לא.
 *
 * כל מספר בדף נמדד מהמסד ב-10.9.2026, לא נזכר. הדף קיים כדי שהמשתמשת
 * לא תסיק מסקנה שגויה מדירוג שנראה חד-משמעי: היעדר ח"כ מהתוצאות אינו
 * עדות לחוסר עשייה, ומעבר חוק אינו מדד לאיכות ח"כ.
 */

interface Fact {
  value: string;
  label: string;
}

function Figures({ items }: { items: Fact[] }) {
  return (
    <div className="my-5 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
      {items.map(f => (
        <div key={f.label} className="bg-surface px-4 py-3">
          <div className="text-section font-medium text-ink" data-numeric>{f.value}</div>
          <div className="text-meta text-mute mt-0.5">{f.label}</div>
        </div>
      ))}
    </div>
  );
}

const ENTRIES = [
  { id: 'ministers',  q: 'מדוע שרים כמעט לא מופיעים בתוצאות השאלון?' },
  { id: 'passed',     q: 'מדוע הדירוג אינו מבוסס על חוקים שעברו?' },
  { id: 'rebel',      q: 'מה זו משמעת קואליציונית, ומיהו ח"כ מורד?' },
  { id: 'missing',    q: 'ח"כ שלא הופיע בתוצאות — לא עושה את עבודתו?' },
  { id: 'confidence', q: 'מדוע אחוז הביטחון גבוה יותר לח"כי אופוזיציה?' },
  { id: 'stopped',    q: 'מה קרה ל-893 ההצעות שכתוב עליהן "ההליך נעצר"?' },
  { id: 'network',    q: 'מה רשת הקשרים מספרת, ומה אומר קשר הדוק או רופף?' },
  { id: 'garbled',    q: 'מדוע נוסח החוק נראה לפעמים משובש?' },
];

export default async function DidYouKnowPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  return (
    <div className="mx-auto max-w-3xl px-6 py-12" dir="rtl">
      <header className="mb-10">
        <p className="label-he mb-2">הידעת?</p>
        <h1 className="text-page mb-4">מה הנתונים אומרים — ומה הם לא</h1>
        <p className="text-body font-content text-ink-2">
          דירוג נראה חד-משמעי, ולכן קל להסיק ממנו יותר משהוא באמת אומר. הדף הזה
          מסביר מה נמדד, מה לא, ולמה. כל מספר כאן נשלף מהמסד ולא נכתב מהזיכרון.
        </p>
      </header>

      <nav aria-label="ניווט בעמוד" className="mb-12 rounded-card border border-line bg-surface p-5">
        <ol className="flex flex-col gap-2">
          {ENTRIES.map((e, i) => (
            <li key={e.id} className="flex gap-3">
              <span className="text-meta text-mute shrink-0 pt-0.5" data-numeric>{i + 1}</span>
              <a href={`#${e.id}`} className="text-ui text-accent hover:underline">{e.q}</a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-12">

        <section id="ministers">
          <h2 className="text-section mb-3">{ENTRIES[0].q}</h2>
          <p className="text-body font-content text-ink-2">
            כי שר כמעט אינו יוזם הצעות חוק פרטיות. הוא מקדם חקיקה דרך המשרד שלו,
            כהצעת חוק ממשלתית — ושם הוא אינו רשום כיוזם. השאלון מדרג לפי יוזמה,
            ולכן שר נראה בו פחות פעיל ממה שהוא בפועל.
          </p>
          <Figures items={[
            { value: '47.3',  label: 'הצעות חוק בממוצע לח"כ ששימש שר' },
            { value: '159.4', label: 'הצעות חוק בממוצע לח"כ שאינו שר' },
            { value: '22',    label: 'ח"כים שלא יזמו ולו הצעה אחת — כולם שרים' },
          ]} />
          <p className="text-ui text-mute">
            ברשימת ה-22 נמצאים בנימין נתניהו, בצלאל סמוטריץ&apos;, יואב גלנט, יריב
            לוין ומירי רגב. אין זו עדות לחוסר עשייה, אלא לכך שהעשייה שלהם אינה
            מהסוג שהמסד הזה סופר.
          </p>
        </section>

        <section id="passed">
          <h2 className="text-section mb-3">{ENTRIES[1].q}</h2>
          <p className="text-body font-content text-ink-2">
            כי מעבר של חוק הוא אירוע נדיר, והוא נקבע כמעט לגמרי על ידי השאלה אם
            ההצעה נתמכת בידי הקואליציה. דירוג לפי חוקים שעברו היה מודד השתייכות
            פוליטית, לא עבודה.
          </p>
          <Figures items={[
            { value: '6.9%',      label: 'מהצעות החוק עברו — 502 מתוך 7,296' },
            { value: '409',       label: 'מתוך 4,660 הצעות מסווגות הגיעו להצבעת מליאה' },
            { value: '0.6 / 0.4', label: 'משקל היוזמה מול משקל ההצבעות בדירוג' },
          ]} />
          <p className="text-ui text-mute">
            לכן הדירוג נשען בעיקר על יוזמה — מה הח&quot;כ ניסה לקדם — ורק במידה
            פחותה על הצבעות.
          </p>
        </section>

        <section id="rebel">
          <h2 className="text-section mb-3">{ENTRIES[2].q}</h2>
          <p className="text-body font-content text-ink-2">
            משמעת קואליציונית היא הנוהג שלפיו חברי סיעה מצביעים יחד, גם כשדעתם
            שונה. בכנסת ה-25 היא כמעט מוחלטת — ולכן הצבעה בודדת כמעט אינה מבחינה
            בין שני ח&quot;כים באותה סיעה. שניהם הצביעו אותו דבר, כי כך הוחלט.
          </p>
          <Figures items={[
            { value: '99.9%', label: 'משמעת סיעתית — 445 מרידות מתוך 428,068' },
            { value: '5.3%',  label: 'מההצבעות היו בהן מרידה כלשהי — 336 מתוך 6,319' },
            { value: '445',   label: 'מרידות בסך הכול בכנסת ה-25' },
          ]} />
          <p className="text-body font-content text-ink-2">
            <strong className="font-medium text-ink">ח&quot;כ מורד</strong> הוא חבר
            כנסת שהצביע נגד עמדת הרוב בסיעתו. מכיוון שזה קורה ב-0.1% מהמקרים, מרידה
            היא אחד האותות הבודדים בנתוני ההצבעות שמספרים משהו על הח&quot;כ עצמו
            ולא על הסיעה שלו. זו הסיבה שהמונח קיים באתר, ושיש לו{' '}
            <Link href="/mks?groupBy=rebels" className="text-accent hover:underline">
              מדד משלו
            </Link>
            .
          </p>
        </section>

        <section id="missing">
          <h2 className="text-section mb-3">{ENTRIES[3].q}</h2>
          <p className="text-body font-content text-ink-2">
            לא. הדירוג מודד שני דברים בלבד — הצעות חוק שהח&quot;כ יזם, והצבעות
            שתמכו בעמדתך. עבודה פרלמנטרית כוללת הרבה יותר מזה, והחלקים האחרים
            קיימים במסד אך אינם נספרים בדירוג.
          </p>
          <Figures items={[
            { value: '46,102', label: 'רשומות נוכחות בוועדות — לא נספרות' },
            { value: '1,423',  label: 'שאילתות לשרים — לא נספרות' },
            { value: '3.07M',  label: 'תורות דיבור בפרוטוקולים — לא נספרות' },
          ]} />
          <p className="text-ui text-mute">
            היעדר ח&quot;כ מתוצאה בנושא מסוים אומר שלא מצאנו לו יוזמה או הצבעה
            בנושא הזה — לא שהוא אינו פעיל.
          </p>
        </section>

        <section id="confidence">
          <h2 className="text-section mb-3">{ENTRIES[4].q}</h2>
          <p className="text-body font-content text-ink-2">
            אחוז הביטחון מודד כמה פעולות מתועדות עמדו מאחורי הציון — לא כמה
            הח&quot;כ מתאים לך. ח&quot;כי אופוזיציה יוזמים יותר מפי שניים הצעות
            חוק מח&quot;כי קואליציה, ולכן מצטברות להם יותר פעולות מתועדות
            והביטחון שלהם נוטה להיות גבוה יותר.
          </p>
          <Figures items={[
            { value: '163.7', label: 'הצעות חוק בממוצע לח"כ אופוזיציה' },
            { value: '75.9',  label: 'הצעות חוק בממוצע לח"כ קואליציה' },
            { value: '×2.2',  label: 'פער היוזמה בין האופוזיציה לקואליציה' },
          ]} />
          <p className="text-ui text-mute">
            ההסבר הוא שקואליציה מקדמת מדיניות דרך הממשלה, בעוד שאופוזיציה יכולה
            לקדם עמדה בעיקר בהצעת חוק פרטית. ביטחון גבוה משמעו שיש יותר על מה
            להסתמך — לא שההתאמה טובה יותר.
          </p>
        </section>

        <section id="stopped">
          <h2 className="text-section mb-3">{ENTRIES[5].q}</h2>
          <p className="text-body font-content text-ink-2">
            הצעת חוק יכולה להיעצר בכל שלב — היא נמשכת, נדחית, או פשוט אינה מובאת
            להצבעה עד סוף הכהונה. הסטטוס במסד מציין שההליך פסק, אך אינו מציין
            באיזה שלב זה קרה. לכן במסלול החוק מוצג תג &quot;ההליך נעצר&quot; במקום
            שלב, ואיננו משערים.
          </p>
          <Figures items={[
            { value: '893',   label: 'הצעות שההליך שלהן נעצר' },
            { value: '5,042', label: 'הצעות שהוגשו ולא התקדמו הלאה' },
            { value: '854',   label: 'הצעות שעברו קריאה טרומית' },
          ]} />
        </section>

        <section id="network">
          <h2 className="text-section mb-3">{ENTRIES[6].q}</h2>
          <p className="text-body font-content text-ink-2">
            הרשת נבנית מיוזמה משותפת: שני חברי כנסת שחתומים יחד על אותה הצעת
            חוק. זו עדות ליחסי עבודה, לא לחברות ולא להסכמה אידאולוגית — אפשר
            לחתום יחד על הצעה טכנית ולהיחלק בכל השאר.
          </p>
          <Figures items={[
            { value: '5,353', label: 'זוגות ח"כים שחתמו יחד לפחות פעם אחת' },
            { value: '47.9%', label: 'מכלל הזוגות האפשריים בכנסת' },
            { value: '358',   label: 'הצעות משותפות בזוג הצמוד ביותר' },
          ]} />

          <h3 className="text-ui font-medium text-ink mt-6 mb-1">קשר הדוק</h3>
          <p className="text-body font-content text-ink-2">
            223 זוגות חתומים יחד על יותר מ-50 הצעות. ברובם המכריע זו פשוט
            שותפות סיעתית: <strong className="font-medium text-ink">191 מהם
            באותה סיעה</strong>, שם חתימה הדדית היא נוהג שגרתי. המעניינים הם
            <strong className="font-medium text-ink"> 32 הזוגות שחוצים סיעות</strong>
             — שם יש שיתוף פעולה שאינו מובן מאליו.
          </p>

          <h3 className="text-ui font-medium text-ink mt-5 mb-1">קשר רופף</h3>
          <p className="text-body font-content text-ink-2">
            2,088 זוגות חתומים יחד על חמש הצעות או פחות, מהם 688 על הצעה אחת
            בלבד. לרוב מדובר בהצעה אחת שנשאה חתימות רבות, ולא בעבודה מתמשכת.
            קשר כזה כמעט אינו מלמד דבר.
          </p>

          <h3 className="text-ui font-medium text-ink mt-5 mb-1">אין קשר כלל</h3>
          <p className="text-body font-content text-ink-2">
            29 חברי כנסת אינם מופיעים ברשת בכלל. 22 מהם לא יזמו אף הצעת חוק —
            כולם שרים, מאותה סיבה שהם אינם מופיעים בשאלון. שבעה נוספים יזמו
            הצעות אך תמיד לבדם.
          </p>

          <p className="text-ui text-mute mt-5">
            הגרף מציג את 50 הזוגות החזקים ביותר מבין אלה שחתומים על יותר מחמש
            הצעות — כלומר את הקצה העליון, ולא את הרשת כולה.{' '}
            <Link href="/mks?groupBy=alliances" className="text-accent hover:underline">
              לרשת הקשרים
            </Link>
          </p>
        </section>

        <section id="garbled">
          <h2 className="text-section mb-3">{ENTRIES[7].q}</h2>
          <p className="text-body font-content text-ink-2">
            נוסח ההצעה מחולץ אוטומטית מקובץ PDF של הכנסת. בקבצים האלה הטקסט שמור
            לפי סדר ההופעה על הדף ולא לפי סדר הקריאה, ובעברית התוצאה היא סוגריים
            שמתהפכים, מספרים שנודדים לצד הלא נכון ומילים שנדבקות זו לזו.
          </p>
          <p className="text-ui text-mute">
            הרצנו תיקון אוטומטי על 6,564 מההצעות, אך הוא אינו מושלם — נמצאו הצעות
            מתוקנות שהנוסח שלהן עדיין משובש. לכן האזהרה מוצגת על כל נוסח, והנוסח
            הרשמי המחייב הוא זה שבאתר הכנסת.
          </p>
        </section>

      </div>

      <footer className="mt-16 border-t border-line pt-5">
        <p className="text-meta text-mute">
          כל הנתונים בעמוד נמדדו ממסד הנתונים של האתר ב-10 בספטמבר 2026, ומתייחסים
          לכנסת ה-25.
        </p>
      </footer>
    </div>
  );
}
