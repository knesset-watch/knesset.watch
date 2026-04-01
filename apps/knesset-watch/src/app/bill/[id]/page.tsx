import { notFound } from 'next/navigation';
import { getBillById } from '@/lib/knesset-db';
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
  'ממשלתית': 'הצעת חוק ממשלתית',
  'פרטית': 'הצעת חוק פרטית',
};

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const billId = Number(id);
  if (isNaN(billId)) notFound();

  const bill = getBillById(billId);
  if (!bill) notFound();

  const initDate = formatDate(bill.init_date);
  const pubDate = formatDate(bill.publication_date);

  // Build a simple status timeline from available data
  const timeline: Array<{ label: string; date: string | null; done: boolean }> = [
    { label: 'הגשה', date: initDate, done: true },
    { label: 'ועדה', date: null, done: !!bill.committee_name },
    { label: 'פרסום', date: pubDate, done: !!pubDate },
    { label: 'עבר', date: null, done: bill.is_passed === 1 },
  ];

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <Link href="/bills" className="font-black hover:text-black transition-colors">ספר החוקים</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black truncate max-w-xs">{bill.title}</span>
        </nav>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
              bill.is_passed ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-gray-100 text-gray-600'
            }`}>
              {bill.is_passed ? 'עבר' : bill.status_desc ?? 'בטיפול'}
            </span>
            {bill.subtype && (
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-wide">
                {SUBTYPE_LABEL[bill.subtype] ?? bill.subtype}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black leading-snug">{bill.title}</h1>
        </div>

        {/* Status Timeline */}
        <div className="mb-8 rounded-2xl border border-black/8 p-5">
          <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-4">מסלול החוק</div>
          <div className="flex items-center gap-0">
            {timeline.map((step, i) => (
              <div key={step.label} className="flex-1 flex items-center">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border-2 ${
                    step.done
                      ? 'bg-teal-600 border-teal-600 text-white'
                      : 'bg-white border-gray-200 text-gray-300'
                  }`}>
                    {step.done ? '✓' : String(i + 1)}
                  </div>
                  <div className="text-[11px] font-black mt-1 text-center">{step.label}</div>
                  {step.date && <div className="text-[10px] text-gray-400 text-center mt-0.5">{step.date}</div>}
                </div>
                {i < timeline.length - 1 && (
                  <div className={`h-0.5 flex-1 -mt-5 ${step.done ? 'bg-teal-400' : 'bg-gray-100'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {bill.committee_name && (
            <div className="rounded-2xl border border-black/8 p-4">
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-wide mb-1">ועדה</div>
              <Link
                href={`/committee/${encodeURIComponent(bill.committee_name)}`}
                className="text-sm font-black text-teal-700 hover:text-teal-900 transition-colors"
              >
                {bill.committee_name}
              </Link>
            </div>
          )}
          {bill.macro_agenda && (
            <div className="rounded-2xl border border-black/8 p-4">
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-wide mb-1">תחום</div>
              <div className="text-sm font-black">{bill.macro_agenda}</div>
            </div>
          )}
          {bill.micro_agenda && (
            <div className="rounded-2xl border border-black/8 p-4 sm:col-span-2">
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-wide mb-1">נושא</div>
              <div className="text-sm font-black">{bill.micro_agenda}</div>
            </div>
          )}
        </div>

        {/* Initiators */}
        {bill.initiators.length > 0 && (
          <div className="mb-8">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">יוזמים</div>
            <div className="flex flex-wrap gap-2">
              {bill.initiators.map(ini => (
                <Link
                  key={ini.person_id}
                  href={`/mk/${ini.slug ?? ini.person_id}`}
                  className="text-sm font-black px-3 py-1.5 rounded-full border border-black/10 hover:bg-gray-50 transition-colors"
                >
                  {ini.first_name} {ini.last_name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {bill.summary && (
          <div className="mb-8 rounded-2xl border border-black/8 p-5">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">תקציר</div>
            <p className="text-sm leading-relaxed text-gray-700">{bill.summary}</p>
          </div>
        )}

        {/* Document link */}
        {bill.doc_url && (
          <div className="mb-8">
            <a
              href={bill.doc_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-black text-teal-700 hover:text-teal-900 transition-colors border border-teal-200 bg-teal-50 px-4 py-2 rounded-xl"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 1v8m0 0L4 6m3 3 3-3M1 11h12"/>
              </svg>
              מסמך הצעת חוק
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
