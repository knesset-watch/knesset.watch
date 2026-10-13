'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CLUSTER_TOPICS } from '@/lib/axis-clusters';
import { TOPIC_COLOR, TOPIC_FALLBACK } from '@/lib/ui/colors';
import { DomainIcon } from './domain-icons';

/*
  השלב הראשון של השאלון, בעמוד הבית. ההמשך ב-/agenda-keywords.

  זה הפיצ'ר של הבחירות, ולכן הוא הבלוק הראשון אחרי ההירו ולא השלישי.
  הלוגיקה לא השתנתה: עד שלושה תחומים, והם עוברים ב-query string כדי
  שהשאלון ייפתח ישר בשלב הנושאים ולא ישאל שוב.
*/

/** שמונת נושאי-העל של הטקסונומיה, נגזרו מהצעות החוק עצמן */
const PICKABLE_DOMAINS = CLUSTER_TOPICS;

export function HomeQuestionnaire() {
  const [picked, setPicked] = useState<string[]>([]);
  const router = useRouter();

  function toggle(id: string) {
    setPicked(prev => {
      if (prev.includes(id)) return prev.filter(d => d !== id);
      return [...prev, id];
    });
  }

  function start() {
    if (picked.length === 0) return;
    router.push(`/agenda-keywords?topics=${picked.join(',')}`);
  }

  const helper =
    picked.length === 0
      ? 'בוחרים תחום אחד או יותר כדי להתחיל'
      : picked.length === 1 ? 'נבחר תחום אחד' : `נבחרו ${picked.length} תחומים`;

  return (
    <section aria-labelledby="who-works-heading">
      <span className="inline-block rounded-control border border-accent-lit bg-accent-wash px-3 py-0.5 text-label font-medium text-accent-ink">
        בחירות 2026
      </span>
      <h2 id="who-works-heading" className="text-page mt-3 mb-2">מי עובדים בשבילך?</h2>
      <p className="text-body text-ink-2 max-w-[645px]">
        הכירו את מצפן האג׳נדות של אפרכסת לכנסת - בוחרים את התחומים שחשובים לך
        ומסמנים מה העמדה שלך בתוך אותו תחום, ומגלים אילו חברי כנסת פעלו בדיוק
        בכיוון הזה. בהצעות חוק שיזמו ובהצבעות שתמכו בהן.
      </p>
      <p className="mt-3 text-ui text-ink-2">
        בוחרים <strong className="font-semibold text-ink">תחום אחד או יותר</strong>. אפשר להוסיף עוד בכל שלב.
      </p>

      {/*
        שתי עמודות: הרשימה מימין (הראשונה בכיוון הקריאה), הכפתור וההערה
        משמאל. בטלפון הן נערמות באותו סדר.
      */}
      <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,363px)_minmax(0,300px)] md:justify-between">
        <ul className="flex flex-col gap-2" role="group" aria-label="בחירת תחומים">
          {PICKABLE_DOMAINS.map(d => {
            const selected = picked.includes(d.id);
            const color = TOPIC_COLOR[d.label] ?? TOPIC_FALLBACK;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => toggle(d.id)}
                  aria-pressed={selected}
                  /*
                    צבע התחום הוא מזהה: אותו גוון בשאלון, בתרשים ובכרטיסים.
                    הוא מגיע מהקוד ולא מהמערכת, ולכן inline. color-mix מייצר
                    את הרקע הבהיר בלי לנהל 8 גוונים נוספים.
                  */
                  style={selected ? {
                    borderColor: color,
                    backgroundColor: `color-mix(in srgb, ${color} 8%, var(--color-surface))`,
                  } : undefined}
                  className={`w-full flex items-center gap-3 rounded-card border-2 bg-surface px-2.5 py-2.5 text-right transition-colors ${
                    selected ? 'text-ink' : 'border-transparent hover:border-line'
                  }`}
                >
                  <span
                    style={selected ? { color, backgroundColor: `color-mix(in srgb, ${color} 14%, var(--color-surface))` } : undefined}
                    className="flex items-center justify-center w-[34px] h-[34px] shrink-0 rounded-control bg-surface-2 text-ink"
                  >
                    <DomainIcon label={d.label} className="w-6 h-6" />
                  </span>
                  <span className="flex-1 text-ui font-semibold text-ink">{d.label}</span>
                  {/* הסימון נוסף לצבע ולמסגרת: צבע לבדו אינו מצב */}
                  {selected && <span className="text-ui shrink-0 pl-1" style={{ color }} aria-hidden="true">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col items-start gap-8">
          <div className="flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={start}
              disabled={picked.length === 0}
              className="inline-flex items-center gap-2.5 rounded-control bg-navy px-4 py-3 text-ui font-semibold text-white hover:bg-navy-deep transition-colors disabled:bg-surface-2 disabled:text-mute disabled:cursor-not-allowed"
            >
              לשאלון
              {/* חץ שמאלה = קדימה, כי הקריאה מימין לשמאל */}
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 15.8333L4.16667 10L10 4.16667" />
                <path d="M15.8333 10H4.16667" />
              </svg>
            </button>
            <p className="text-label text-mute" aria-live="polite">{helper}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
