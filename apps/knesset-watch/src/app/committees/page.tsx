import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import { getAllCommitteeActivity } from '@/lib/knesset-db';
import { tursoAvailable, getTursoAllCommitteeActivity } from '@/lib/turso-db';
import Link from 'next/link';

export default async function CommitteesPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const committees = tursoAvailable()
    ? await getTursoAllCommitteeActivity()
    : getAllCommitteeActivity();
  const totalSessions = committees.reduce((sum, c) => sum + c.sessionCount, 0);

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-8">
          <Link href="/" className="text-sm font-black text-gray-400 hover:text-black transition-colors">
            → ראשי
          </Link>
        </div>

        <h1 className="text-3xl font-black leading-tight mb-1">ועדות הכנסת</h1>
        <p className="text-sm text-gray-400 font-medium mb-8">
          {committees.length} ועדות · {totalSessions.toLocaleString('he-IL')} ישיבות מתועדות
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {committees.map(c => (
            <Link
              key={c.committeeId}
              href={`/committee/${encodeURIComponent(c.name)}`}
              className="group rounded-2xl border border-black/8 p-5 hover:border-black/20 hover:shadow-sm transition-all"
            >
              <div className="font-black text-sm leading-snug mb-3 group-hover:text-black text-gray-900">
                {c.name}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase text-gray-400 mb-0.5">ישיבות</span>
                  <span className="text-xl font-black">{c.sessionCount.toLocaleString('he-IL')}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {c.lastProtocolDate && (
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-black uppercase text-teal-600 mb-0.5">דיון אחרון</span>
                      <span className="text-xs font-bold text-teal-700">
                        {new Date(c.lastProtocolDate).toLocaleDateString('he-IL', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </span>
                    </div>
                  )}
                  {!c.lastProtocolDate && c.lastSessionDate && (
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-black uppercase text-gray-400 mb-0.5">אחרונה</span>
                      <span className="text-xs font-bold text-gray-500">
                        {new Date(c.lastSessionDate).toLocaleDateString('he-IL', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
