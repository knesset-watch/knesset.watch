import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CLUSTER_TOPICS } from '@/lib/axis-clusters';
import { getBillsForIssues, countBillsByIssue } from '@/lib/knesset-db';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ topic: string }>;
}

/**
 * נושא-על אחד: האשכולות שבתוכו, והצעות החוק שמאחורי כל אשכול.
 *
 * החוקים מגיעים דרך bill_political_classification — הגשר מציר מדיניות
 * להצעת חוק. קודם עמד כאן AgendaTopicClient שהתאים מילות מפתח לכותרות
 * הצבעות בלבד, ולא ידע להראות ולו חוק אחד.
 */
export default async function AgendaTopicPage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const { topic: rawTopic } = await params;
  const topicId = decodeURIComponent(rawTopic);
  /*
    מזהים ישנים לא מפילים ל-404.

    תצוגת האג׳נדות ב-/mks עדיין מקשרת לכאן עם ערכי macro_agenda מההצבעות
    ('ביטחון וצבא', 'משפט ופשיעה' ...) — 11 תוויות שרק אחת מהן תואמת
    לשמונה נושאי-העל החדשים. במקום להראות שגיאה, מזהה שלא נמצא מפנה
    לרשימת האג׳נדות, שם אפשר לבחור נושא קיים.
  */
  const topic =
    CLUSTER_TOPICS.find(t => t.id === topicId) ??
    CLUSTER_TOPICS.find(t => t.label === topicId);
  if (!topic) redirect('/agendas');

  // שאילתה אחת לכל הנושא, ואז קיבוץ לפי אשכול — במקום שאילתה לכל אשכול
  const issueIds = topic.clusters.flatMap(c => c.questions.map(q => q.issueId));
  const [bills, countByIssue] = [
    getBillsForIssues(issueIds, 400),
    countBillsByIssue(issueIds),
  ];

  const clusterOfIssue = new Map<string, string>();
  for (const c of topic.clusters) {
    for (const q of c.questions) clusterOfIssue.set(q.issueId, c.clusterId);
  }

  const billsByCluster = new Map<string, typeof bills>();
  for (const b of bills) {
    const cid = clusterOfIssue.get(b.issueId);
    if (!cid) continue;
    if (!billsByCluster.has(cid)) billsByCluster.set(cid, []);
    billsByCluster.get(cid)!.push(b);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12" dir="rtl">
      <nav className="mb-6 text-meta text-mute">
        <Link href="/agendas" className="hover:text-accent transition-colors">אג׳נדות</Link>
        <span className="mx-2">›</span>
        <span>{topic.label}</span>
      </nav>

      <header className="mb-10">
        <h1 className="text-page mb-3">{topic.label}</h1>
        <p className="text-ui text-mute">
          <span data-numeric>{topic.clusters.length}</span> אשכולות ·{' '}
          <span data-numeric>{topic.questionCount}</span> שאלות ·{' '}
          <span data-numeric>{topic.billCount.toLocaleString()}</span> הצעות חוק
        </p>

        <Link
          href={`/agenda-keywords?topics=${topic.id}`}
          className="mt-5 inline-block rounded-control bg-accent px-4 py-2.5 text-ui font-medium text-white transition-colors hover:bg-accent-ink"
        >
          מי עובד בשבילך בנושא הזה?
        </Link>
      </header>

      <div className="flex flex-col gap-8">
        {topic.clusters.map(cluster => {
          const clusterBills = billsByCluster.get(cluster.clusterId) ?? [];
          const total = cluster.questions.reduce(
            (sum, q) => sum + (countByIssue.get(q.issueId) ?? 0), 0,
          );

          return (
            <section key={cluster.clusterId}>
              <div className="flex items-baseline justify-between gap-4 mb-1">
                <h2 className="text-section">{cluster.label}</h2>
                <span className="shrink-0 text-meta text-mute" data-numeric>
                  {total.toLocaleString()} הצעות חוק מסווגות
                </span>
              </div>

              <ul className="mb-4 flex flex-col gap-1">
                {cluster.questions.map(q => (
                  <li key={q.issueId} className="text-ui font-content text-ink-2">
                    {q.question}
                  </li>
                ))}
              </ul>

              {clusterBills.length === 0 ? (
                <p className="rounded-card border border-line bg-surface px-4 py-3 text-meta text-mute">
                  אף הצעת חוק לא סווגה לאשכול הזה עדיין.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {clusterBills.slice(0, 8).map(b => (
                    <Link
                      key={`${b.id}-${b.issueId}`}
                      href={`/bill/${b.id}`}
                      className="flex items-start gap-3 rounded-control border border-line bg-surface px-4 py-3 transition-colors hover:border-accent"
                    >
                      <span
                        className={`shrink-0 rounded-control px-2 py-0.5 text-meta font-medium ${
                          b.isPassed
                            ? 'bg-pass-wash text-pass'
                            : 'bg-surface-2 text-mute'
                        }`}
                      >
                        {b.isPassed ? 'עבר' : 'בהליך'}
                      </span>

                      <span className="min-w-0 flex-1 text-ui font-content text-ink">
                        {b.title}
                      </span>
                    </Link>
                  ))}

                  {clusterBills.length > 8 && (
                    <p className="text-meta text-mute mt-1">
                      ועוד {clusterBills.length - 8} הצעות חוק באשכול הזה.
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
