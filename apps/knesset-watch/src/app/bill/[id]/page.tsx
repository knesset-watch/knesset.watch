import { notFound, redirect } from 'next/navigation';
import { getBillById } from '@/lib/knesset-db';
import { billSteps, billStopped } from '@/lib/bill-stage';
import { checkServerAuth } from '@/lib/ui/auth-utils';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

const SUBTYPE_LABEL: Record<string, string> = {
  'ממשלתית': 'הצעת חוק ממשלתית (יוזמת הממשלה)',
  'פרטית': 'הצעת חוק פרטית (יוזמת ח״כ)',
};

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const { id } = await params;
  const billId = Number(id);
  if (isNaN(billId)) notFound();

  const bill = getBillById(billId);
  if (!bill) notFound();
  // bill.init_date ריק בכל 7,296 השורות, ולכן אין תאריך הגשה להציג
  const pubDate = formatDate(bill.publication_date);

  /*
    ארבעת שלבי החקיקה, נגזרים מ-status_id (מלא ב-100% מהשורות).
    קודם היו כאן שלושה שלבים שנגזרו מ-committee_name ומ-is_passed בלבד.
  */
  const steps = billSteps(bill.status_id, !!bill.committee_name);
  const stopped = billStopped(bill.status_id);

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-mute mb-6">
          <Link href="/" className="font-medium hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <Link href="/bills" className="font-medium hover:text-black transition-colors">חוקים</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-medium truncate max-w-xs">{bill.title}</span>
        </nav>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-meta font-medium px-2 py-0.5 rounded-full ${
              bill.is_passed ? 'bg-accent-wash text-accent border border-line' : 'bg-gray-100 text-ink-2'
            }`}>
              {bill.is_passed ? 'עבר' : bill.status_desc ?? 'בתהליך'}
            </span>
            {bill.subtype && (
              <span className="text-meta font-medium text-mute">
                {SUBTYPE_LABEL[bill.subtype] ?? bill.subtype}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-medium leading-snug">{bill.title}</h1>
        </div>

        {/* Status Timeline */}
        <div className="mb-8 rounded-2xl border border-black/8 p-5">
          <div className="flex items-baseline justify-between gap-3 mb-5">
            <h2 className="text-label font-medium text-mute">מסלול החוק</h2>
            {stopped ? (
              <span className="text-meta font-medium rounded-control bg-fail-wash text-fail px-2 py-1">
                ההליך נעצר
              </span>
            ) : (
              <span className="text-meta text-mute">
                {steps.filter(st => st.reached).length} מתוך {steps.length} שלבים
              </span>
            )}
          </div>

          {/*
            העיגולים הריקים הציגו קודם את מספר הסידור של השלב (1, 2, 3) —
            מספר שלא נשא שום מידע. עכשיו שלב שהושלם מסומן ב-✓, השלב הנוכחי
            מודגש בטבעת, ושלב שטרם הגיע נשאר עיגול ריק בלי מספר מטעה.
          */}
          <ol className="flex items-start gap-0">
            {steps.map((step, i) => (
              <li key={step.label} className="flex-1 flex items-start">
                <div className="flex flex-col items-center flex-1 min-w-0">
                  <div
                    aria-hidden="true"
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-ui font-medium border-2 transition-colors ${
                      step.reached
                        ? 'bg-accent border-accent text-white'
                        : 'bg-surface border-line text-mute'
                    } ${step.current ? 'ring-4 ring-accent/20' : ''}`}
                  >
                    {step.reached ? '✓' : ''}
                  </div>

                  <div className={`text-label mt-2 text-center px-1 ${
                    step.reached ? 'font-medium text-ink' : 'text-mute'
                  }`}>
                    {step.label}
                  </div>

                  {step.current && !stopped && (
                    <div className="text-meta text-accent mt-0.5">כאן עכשיו</div>
                  )}

                  <span className="sr-only">
                    {step.reached ? 'הושלם' : 'טרם הגיע לשלב הזה'}
                  </span>
                </div>

                {i < steps.length - 1 && (
                  <div className={`h-0.5 flex-1 mt-[18px] ${
                    steps[i + 1].reached ? 'bg-accent' : 'bg-line'
                  }`} />
                )}
              </li>
            ))}
          </ol>

          {pubDate && (
            <p className="text-meta text-mute mt-4">התקבל בכנסת ב־{pubDate}</p>
          )}
        </div>

        {/* Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {bill.committee_name && (
            <div className="rounded-2xl border border-black/8 p-4">
              <div className="text-meta font-medium text-mute mb-1">ועדה</div>
              <Link
                href={`/committee/${encodeURIComponent(bill.committee_name)}`}
                className="text-sm font-medium text-accent hover:text-accent-ink transition-colors"
              >
                {bill.committee_name}
              </Link>
            </div>
          )}
          {bill.macro_agenda && (
            <div className="rounded-2xl border border-black/8 p-4">
              <div className="text-meta font-medium text-mute mb-1">תחום</div>
              <div className="text-sm font-medium">{bill.macro_agenda}</div>
            </div>
          )}
          {bill.micro_agenda && (
            <div className="rounded-2xl border border-black/8 p-4 sm:col-span-2">
              <div className="text-meta font-medium text-mute mb-1">נושא</div>
              <div className="text-sm font-medium">{bill.micro_agenda}</div>
            </div>
          )}
        </div>

        {/* Initiators */}
        {bill.initiators.length > 0 && (
          <div className="mb-8">
            <div className="text-meta font-medium text-mute mb-3">יוזמים</div>
            <div className="flex flex-wrap gap-2">
              {bill.initiators.map(ini => (
                <Link
                  key={ini.person_id}
                  href={`/mk/${ini.slug ?? ini.person_id}`}
                  className="text-sm font-medium px-3 py-1.5 rounded-full border border-black/10 hover:bg-gray-50 transition-colors"
                >
                  {ini.first_name} {ini.last_name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/*
          תקציר, אג׳נדה ונוסח מלא.

          קודם עמדו כאן שני בלוקים שהותנו ב-bill.summary וב-bill.doc_url,
          ושניהם NULL בכל 7,296 השורות — הם לא רונדרו מעולם. הנתונים
          האמיתיים היו במסד כל הזמן הזה: 7,067 תקצירים ב-bill_policy_analysis
          ו-7,165 נוסחים מלאים ב-bill.text_content.
        */}

        {bill.analysisSummary && (
          <section className="mb-8 rounded-card border border-line bg-surface p-5">
            <h2 className="text-section mb-2">תקציר</h2>
            <p className="text-body font-content text-ink-2">{bill.analysisSummary}</p>
          </section>
        )}

        {bill.issues.length > 0 && (
          <section className="mb-8">
            <h2 className="text-section mb-3">האג׳נדה של ההצעה</h2>

            <div className="flex flex-col gap-4">
              {bill.issues.slice(0, 3).map((iss, i) => (
                <div key={i} className="rounded-card border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {iss.domain && (
                      <span className="text-meta font-medium rounded-control bg-accent-wash text-accent-ink px-2 py-1">
                        {iss.domain}
                      </span>
                    )}
                    {iss.isPrimary && (
                      <span className="text-meta text-mute">הסוגיה המרכזית</span>
                    )}
                  </div>

                  {iss.issue && <p className="text-ui font-medium text-ink mb-1">{iss.issue}</p>}
                  {iss.policyChange && (
                    <p className="text-ui font-content text-ink-2 mb-3">{iss.policyChange}</p>
                  )}

                  {(iss.proStance || iss.conStance) && (
                    <div className="grid gap-3 sm:grid-cols-2 mt-3">
                      {iss.proStance && (
                        <div className="rounded-control border-r-2 border-pass bg-pass-wash px-3 py-2">
                          <p className="text-meta font-medium text-pass mb-1">בעד</p>
                          <p className="text-ui font-content text-ink-2">{iss.proStance}</p>
                        </div>
                      )}
                      {iss.conStance && (
                        <div className="rounded-control border-r-2 border-fail bg-fail-wash px-3 py-2">
                          <p className="text-meta font-medium text-fail mb-1">נגד</p>
                          <p className="text-ui font-content text-ink-2">{iss.conStance}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {iss.explanation && (
                    <p className="text-meta text-mute mt-3 font-content">{iss.explanation}</p>
                  )}
                </div>
              ))}
            </div>

            {bill.issues.length > 3 && (
              <p className="text-meta text-mute mt-3">
                ועוד {bill.issues.length - 3} סוגיות משניות בהצעה הזאת.
              </p>
            )}
          </section>
        )}

        {bill.fullText && (
          <section className="mb-8">
            <details className="rounded-card border border-line bg-surface">
              <summary className="cursor-pointer px-5 py-4 text-ui font-medium text-ink">
                נוסח ההצעה המלא
                <span className="text-meta text-mute font-normal mr-2" data-numeric>
                  ({bill.fullTextChars.toLocaleString()} תווים)
                </span>
              </summary>

              <div className="border-t border-line px-5 py-4">
                {/*
                  האזהרה מוצגת תמיד ולא רק כשהדגל 0.
                  נמצאו הצעות עם text_rtl_repaired=1 שהנוסח שלהן עדיין משובש —
                  סוגריים במקום הלא נכון ומילים מודבקות — ולכן הדגל אינו ערובה.
                */}
                <p className="text-meta text-mute mb-3">
                  הנוסח חולץ אוטומטית מקובץ ה-PDF של הכנסת. סדר המילים והסוגריים
                  עלול להשתבש בחלק מהשורות, ובמיוחד במספרים ובכותרות.
                </p>
                <div
                  dir="rtl"
                  className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap text-body font-content text-ink-2"
                >
                  {bill.fullText}
                </div>
              </div>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
