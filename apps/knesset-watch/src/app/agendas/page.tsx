import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CLUSTER_TOPICS, CLUSTER_STATS } from '@/lib/axis-clusters';

export const dynamic = 'force-dynamic';

/**
 * האג׳נדות, בנויות על הטקסונומיה שנגזרה מהחוקים.
 *
 * קודם עמד כאן AgendasClient שקרא את lib/agendas.ts — 60 ערכים שנכתבו
 * ביד עם רשימות מילות מפתח, בלי שום ידיעה על חוקים. זה היה האי האחרון
 * במוצר שלא השתמש בשכבה הקנונית: השאלון, דף הבית ומדד הפעילות כבר
 * עברו אליה, והעמוד הזה נשאר מאחור ולא קושר לאף אחד מהם.
 */
export default async function AgendasPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  return (
    <div className="mx-auto max-w-4xl px-6 py-12" dir="rtl">
      <header className="mb-10">
        <h1 className="text-page mb-3">אג׳נדות</h1>
        <p className="text-body font-content text-mute max-w-2xl">
          שמונה נושאי-על ש{CLUSTER_STATS.clusters} אשכולות המדיניות שלהם נגזרו
          מניתוח של 7,067 הצעות חוק — לא נכתבו מראש. לכל אשכול יש שאלות עם
          עמדות בעד ונגד, ומאחוריהן הצעות החוק עצמן.
        </p>

        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-ui text-ink-2">
          <span><b className="font-medium" data-numeric>{CLUSTER_STATS.topics}</b> נושאי-על</span>
          <span><b className="font-medium" data-numeric>{CLUSTER_STATS.clusters}</b> אשכולות</span>
          <span><b className="font-medium" data-numeric>{CLUSTER_STATS.questions}</b> שאלות</span>
        </div>
      </header>

      <section className="mb-10 rounded-card border border-accent/30 bg-accent-wash p-5">
        <h2 className="text-section mb-1">רוצה לדעת מי עובד בשבילך?</h2>
        <p className="text-ui text-ink-2 mb-4">
          השאלון עובר על הנושאים שבחרת, שואל מה העמדה שלך, ומדרג את חברי הכנסת
          לפי הצעות החוק שיזמו וההצבעות שתמכו בהן.
        </p>
        <Link
          href="/agenda-keywords"
          className="inline-block rounded-control bg-accent px-4 py-2.5 text-ui font-medium text-white transition-colors hover:bg-accent-ink"
        >
          למילוי השאלון
        </Link>
      </section>

      <div className="flex flex-col gap-3">
        {CLUSTER_TOPICS.map(topic => (
          <Link
            key={topic.id}
            href={`/agenda/${topic.id}`}
            className="group rounded-card border border-line bg-surface p-5 transition-colors hover:border-accent"
          >
            <div className="flex items-baseline justify-between gap-4 mb-2">
              <h2 className="text-section group-hover:text-accent transition-colors">
                {topic.label}
              </h2>
              <span className="shrink-0 text-meta text-mute" data-numeric>
                {topic.billCount.toLocaleString()} הצעות חוק
              </span>
            </div>

            <p className="text-meta text-mute mb-3">
              <span data-numeric>{topic.clusters.length}</span> אשכולות ·{' '}
              <span data-numeric>{topic.questionCount}</span> שאלות
            </p>

            <div className="flex flex-wrap gap-1.5">
              {topic.clusters.slice(0, 5).map(c => (
                <span
                  key={c.clusterId}
                  className="rounded-control border border-line px-2 py-1 text-meta text-ink-2"
                >
                  {c.label}
                </span>
              ))}
              {topic.clusters.length > 5 && (
                <span className="px-2 py-1 text-meta text-mute">
                  ועוד {topic.clusters.length - 5}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
