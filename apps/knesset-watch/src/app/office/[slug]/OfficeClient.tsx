'use client';

import Link from 'next/link';
import { OfficeDetail, OfficeActivityJournal } from '@/lib/knesset-db';

interface Props {
  office: OfficeDetail;
  activityJournal?: OfficeActivityJournal | null;
}

const roleTypeColors: Record<string, { badge: string; label: string }> = {
  pm: { badge: 'bg-purple-200 text-purple-900', label: 'ראש ממשלה' },
  'deputy-pm': { badge: 'bg-indigo-200 text-indigo-900', label: 'סגן ראש ממשלה' },
  minister: { badge: 'bg-amber-200 text-amber-900', label: 'שר' },
  deputy: { badge: 'bg-accent-wash text-accent-ink', label: 'סגן שר' },
  acting: { badge: 'bg-orange-200 text-orange-900', label: 'שר בשירות חוקי' },
  other: { badge: 'bg-gray-200 text-ink', label: 'אחר' },
};

const activityTypeColors: Record<string, { badge: string; label: string }> = {
  appointment: { badge: 'bg-green-200 text-green-900', label: '✓ מינוי' },
  dismissal: { badge: 'bg-red-200 text-red-900', label: '✕ פיטורים' },
  rotation: { badge: 'bg-accent-wash text-accent-ink', label: '⟳ רוטציה' },
  reappointment: { badge: 'bg-purple-200 text-purple-900', label: '⟲ מינוי חוזר' },
  expansion: { badge: 'bg-cyan-200 text-cyan-900', label: '↗ הרחבה' },
  reform: { badge: 'bg-yellow-200 text-yellow-900', label: '⚡ רפורמה' },
  initiative: { badge: 'bg-indigo-200 text-indigo-900', label: '📋 יוזמה' },
  controversy: { badge: 'bg-pink-200 text-pink-900', label: '! מחלוקת' },
  policy_launch: { badge: 'bg-accent-wash text-accent-ink', label: '🎯 מדיניות' },
  role_expansion: { badge: 'bg-lime-200 text-lime-900', label: '↗ הרחבת תפקיד' },
  legal_challenge: { badge: 'bg-orange-200 text-orange-900', label: '⚖ משפט' },
  portfolio_transfer: { badge: 'bg-violet-200 text-violet-900', label: '↔ העברת תיקיה' },
};

const controversyColors: Record<string, string> = {
  none: 'bg-gray-100 text-ink-2',
  minor: 'bg-yellow-100 text-yellow-700',
  moderate: 'bg-orange-100 text-orange-700',
  major: 'bg-red-100 text-red-700',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function OfficeClient({ office, activityJournal }: Props) {
  const govLabels: Record<number, string> = {
    36: 'ממשלה 36 (לפיד)',
    37: 'ממשלה 37 (נתניהו)',
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Breadcrumb */}
      <div className="mb-6 text-sm">
        <Link href="/" className="text-accent hover:underline">
          ראשי
        </Link>
        <span className="mx-2">›</span>
        <Link href="/ministers" className="text-accent hover:underline">
          שרים
        </Link>
        <span className="mx-2">›</span>
        <span className="text-ink-2">{office.displayName}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold text-ink">{office.displayName}</h1>
          <div className="flex gap-2">
            {office.isActive && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                ● פעיל
              </span>
            )}
          </div>
        </div>
        {office.shortName && <p className="text-lg text-ink-2">{office.shortName}</p>}
        {office.notes && <p className="mt-2 text-ink-2 text-sm">{office.notes}</p>}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 bg-gray-50 p-4 rounded-lg">
        <div>
          <p className="text-2xl font-bold text-ink">{office.distinctHolderCount}</p>
          <p className="text-sm text-ink-2">שרים שכיהנו</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-ink">{office.timeline.length}</p>
          <p className="text-sm text-ink-2">כהונות</p>
        </div>
        <div>
          <p className="text-sm text-ink-2">מתאריך</p>
          <p className="text-lg font-semibold text-ink">
            {office.timeline[0]?.startDate ? formatDate(office.timeline[0].startDate) : '—'}
          </p>
        </div>
      </div>

      {/* Current Holders */}
      {office.currentHolders.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-ink mb-4">שרים נוכחיים</h2>
          <div className="space-y-3">
            {office.currentHolders.map(entry => (
              <div key={entry.positionId} className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {entry.personSlug ? (
                      <Link href={`/mk/${entry.personSlug}`} className="text-accent hover:underline font-semibold">
                        {entry.personName}
                      </Link>
                    ) : (
                      <span className="font-semibold">{entry.personName}</span>
                    )}
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${roleTypeColors[entry.roleType]?.badge}`}>
                      {roleTypeColors[entry.roleType]?.label}
                    </span>
                  </div>
                  {entry.factionName && (
                    <span className="text-sm text-ink-2">
                      <Link href={`/faction/${encodeURIComponent(entry.factionName)}`} className="text-accent hover:underline">
                        {entry.factionName}
                      </Link>
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-2 mt-2">מתאריך {formatDate(entry.startDate)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-ink mb-4">ציר זמן של כהונות</h2>
        <div className="space-y-3">
          {office.timeline.map((entry, idx) => (
            <div
              key={entry.positionId}
              className={`border rounded-lg p-4 ${entry.isCurrent ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${roleTypeColors[entry.roleType]?.badge}`}>
                      {roleTypeColors[entry.roleType]?.label}
                    </span>
                    {entry.personSlug ? (
                      <Link href={`/mk/${entry.personSlug}`} className="font-semibold text-accent hover:underline">
                        {entry.personName}
                      </Link>
                    ) : (
                      <span className="font-semibold">{entry.personName}</span>
                    )}
                  </div>
                  <p className="text-sm text-ink-2">
                    {formatDate(entry.startDate)} {entry.finishDate ? `– ${formatDate(entry.finishDate)}` : '– כיום'}
                    {entry.durationDays && ` · ${entry.durationDays} ימים`}
                  </p>
                  {entry.factionName && (
                    <p className="text-sm text-ink-2 mt-1">
                      <Link href={`/faction/${encodeURIComponent(entry.factionName)}`} className="text-accent hover:underline">
                        {entry.factionName}
                      </Link>
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {entry.governmentNum && (
                    <p className="text-xs font-semibold text-mute">
                      {govLabels[entry.governmentNum] || `ממשלה ${entry.governmentNum}`}
                    </p>
                  )}
                  {entry.isCurrent && <p className="text-xs font-semibold text-green-700 mt-1">● נוכחי</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity Journal */}
      {activityJournal && activityJournal.activities.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-ink mb-4">רישום פעילות משרדי</h2>
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="bg-accent-wash p-3 rounded border border-line">
              <p className="font-semibold text-accent-ink">{activityJournal.totalEntries}</p>
              <p className="text-accent text-xs">סך פעילויות</p>
            </div>
            <div className="bg-red-50 p-3 rounded border border-red-200">
              <p className="font-semibold text-red-900">{activityJournal.controversyStats.major}</p>
              <p className="text-red-700 text-xs">מחלוקות גדולות</p>
            </div>
            <div className="bg-orange-50 p-3 rounded border border-orange-200">
              <p className="font-semibold text-orange-900">{activityJournal.controversyStats.moderate + activityJournal.controversyStats.minor}</p>
              <p className="text-orange-700 text-xs">מחלוקות קלות/בינוניות</p>
            </div>
            <div className="bg-gray-50 p-3 rounded border border-gray-200">
              <p className="font-semibold text-ink">{Object.keys(activityJournal.activityTypeStats).length}</p>
              <p className="text-ink-2 text-xs">סוגי פעילות</p>
            </div>
          </div>

          <div className="space-y-3">
            {activityJournal.activities.map(activity => (
              <details
                key={activity.id}
                className="border rounded-lg overflow-hidden transition-all hover:shadow-md"
              >
                <summary className={`cursor-pointer p-4 flex items-start justify-between gap-4 select-none ${controversyColors[activity.controversyLevel] || 'bg-gray-50'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0 ${activityTypeColors[activity.activityType]?.badge || 'bg-gray-200'}`}>
                        {activityTypeColors[activity.activityType]?.label || activity.activityType}
                      </span>
                      {activity.controversyLevel !== 'none' && (
                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-white border">
                          {activity.controversyLevel === 'major' && '⚠️ משמעותי'}
                          {activity.controversyLevel === 'moderate' && '⚠️ בינוני'}
                          {activity.controversyLevel === 'minor' && '⚠️ קל'}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-ink">{activity.activityTitle}</h3>
                    <p className="text-sm text-ink-2 mt-1">
                      {formatDate(activity.activityDate)}
                      {activity.affectedPersonName && ` · ${activity.affectedPersonName}`}
                      {activity.coalitionParty && ` · ${activity.coalitionParty}`}
                    </p>
                  </div>
                  <div className="text-right text-xs text-mute flex-shrink-0">
                    ثقة: {activity.confidenceLevel}%
                  </div>
                </summary>

                <div className="bg-white border-t border-gray-200 p-4 space-y-4">
                  <div>
                    <h4 className="font-semibold text-ink mb-2">תיאור</h4>
                    <p className="text-ink-2 text-sm leading-relaxed">{activity.description}</p>
                  </div>

                  {activity.hebrewNotes && (
                    <div>
                      <h4 className="font-semibold text-ink mb-2">הערות בעברית</h4>
                      <p className="text-ink-2 text-sm">{activity.hebrewNotes}</p>
                    </div>
                  )}

                  {activity.policyFocus && (
                    <div>
                      <h4 className="font-semibold text-ink mb-2">מוקד מדיניות</h4>
                      <p className="text-ink-2 text-sm">{activity.policyFocus}</p>
                    </div>
                  )}

                  {activity.notes && (
                    <div>
                      <h4 className="font-semibold text-ink mb-2">הערות</h4>
                      <p className="text-ink-2 text-sm">{activity.notes}</p>
                    </div>
                  )}

                  <div className="flex gap-4 flex-wrap text-xs">
                    {activity.dataSource && (
                      <div>
                        <span className="text-mute">מקור:</span>
                        <span className="text-ink-2 ml-1 font-mono">{activity.dataSource}</span>
                      </div>
                    )}
                    {activity.sourceUrl && (
                      <a
                        href={activity.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        לקרא עוד →
                      </a>
                    )}
                    {activity.budgetAllocation && (
                      <div>
                        <span className="text-mute">תקציב:</span>
                        <span className="text-ink-2 ml-1 font-semibold">₪{activity.budgetAllocation.toLocaleString('he-IL')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
