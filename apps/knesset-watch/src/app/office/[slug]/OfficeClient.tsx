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
  deputy: { badge: 'bg-blue-200 text-blue-900', label: 'סגן שר' },
  acting: { badge: 'bg-orange-200 text-orange-900', label: 'שר בשירות חוקי' },
  other: { badge: 'bg-gray-200 text-gray-900', label: 'אחר' },
};

const activityTypeColors: Record<string, { badge: string; label: string }> = {
  appointment: { badge: 'bg-green-200 text-green-900', label: '✓ מינוי' },
  dismissal: { badge: 'bg-red-200 text-red-900', label: '✕ פיטורים' },
  rotation: { badge: 'bg-blue-200 text-blue-900', label: '⟳ רוטציה' },
  reappointment: { badge: 'bg-purple-200 text-purple-900', label: '⟲ מינוי חוזר' },
  expansion: { badge: 'bg-cyan-200 text-cyan-900', label: '↗ הרחבה' },
  reform: { badge: 'bg-yellow-200 text-yellow-900', label: '⚡ רפורמה' },
  initiative: { badge: 'bg-indigo-200 text-indigo-900', label: '📋 יוזמה' },
  controversy: { badge: 'bg-pink-200 text-pink-900', label: '! מחלוקת' },
  policy_launch: { badge: 'bg-teal-200 text-teal-900', label: '🎯 מדיניות' },
  role_expansion: { badge: 'bg-lime-200 text-lime-900', label: '↗ הרחבת תפקיד' },
  legal_challenge: { badge: 'bg-orange-200 text-orange-900', label: '⚖ משפט' },
  portfolio_transfer: { badge: 'bg-violet-200 text-violet-900', label: '↔ העברת תיקיה' },
};

const controversyColors: Record<string, string> = {
  none: 'bg-gray-100 text-gray-700',
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
        <Link href="/" className="text-blue-600 hover:underline">
          ראשי
        </Link>
        <span className="mx-2">›</span>
        <Link href="/ministers" className="text-blue-600 hover:underline">
          שרים
        </Link>
        <span className="mx-2">›</span>
        <span className="text-gray-700">{office.displayName}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold text-gray-900">{office.displayName}</h1>
          <div className="flex gap-2">
            {office.isActive && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                ● פעיל
              </span>
            )}
          </div>
        </div>
        {office.shortName && <p className="text-lg text-gray-600">{office.shortName}</p>}
        {office.notes && <p className="mt-2 text-gray-600 text-sm">{office.notes}</p>}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-8 bg-gray-50 p-4 rounded-lg">
        <div>
          <p className="text-2xl font-bold text-gray-900">{office.distinctHolderCount}</p>
          <p className="text-sm text-gray-600">שרים שכיהנו</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{office.timeline.length}</p>
          <p className="text-sm text-gray-600">כהונות</p>
        </div>
        <div>
          <p className="text-sm text-gray-600">מתאריך</p>
          <p className="text-lg font-semibold text-gray-900">
            {office.timeline[0]?.startDate ? formatDate(office.timeline[0].startDate) : '—'}
          </p>
        </div>
      </div>

      {/* Current Holders */}
      {office.currentHolders.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">שרים נוכחיים</h2>
          <div className="space-y-3">
            {office.currentHolders.map(entry => (
              <div key={entry.positionId} className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {entry.personSlug ? (
                      <Link href={`/mk/${entry.personSlug}`} className="text-blue-600 hover:underline font-semibold">
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
                    <span className="text-sm text-gray-600">
                      <Link href={`/faction/${encodeURIComponent(entry.factionName)}`} className="text-blue-600 hover:underline">
                        {entry.factionName}
                      </Link>
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-2">מתאריך {formatDate(entry.startDate)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">ציר זמן של כהונות</h2>
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
                      <Link href={`/mk/${entry.personSlug}`} className="font-semibold text-blue-600 hover:underline">
                        {entry.personName}
                      </Link>
                    ) : (
                      <span className="font-semibold">{entry.personName}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    {formatDate(entry.startDate)} {entry.finishDate ? `– ${formatDate(entry.finishDate)}` : '– כיום'}
                    {entry.durationDays && ` · ${entry.durationDays} ימים`}
                  </p>
                  {entry.factionName && (
                    <p className="text-sm text-gray-600 mt-1">
                      <Link href={`/faction/${encodeURIComponent(entry.factionName)}`} className="text-blue-600 hover:underline">
                        {entry.factionName}
                      </Link>
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {entry.governmentNum && (
                    <p className="text-xs font-semibold text-gray-500">
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
          <h2 className="text-xl font-bold text-gray-900 mb-4">רישום פעילות משרדי</h2>
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div className="bg-blue-50 p-3 rounded border border-blue-200">
              <p className="font-semibold text-blue-900">{activityJournal.totalEntries}</p>
              <p className="text-blue-700 text-xs">סך פעילויות</p>
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
              <p className="font-semibold text-gray-900">{Object.keys(activityJournal.activityTypeStats).length}</p>
              <p className="text-gray-700 text-xs">סוגי פעילות</p>
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
                    <h3 className="font-semibold text-gray-900">{activity.activityTitle}</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {formatDate(activity.activityDate)}
                      {activity.affectedPersonName && ` · ${activity.affectedPersonName}`}
                      {activity.coalitionParty && ` · ${activity.coalitionParty}`}
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-500 flex-shrink-0">
                    ثقة: {activity.confidenceLevel}%
                  </div>
                </summary>

                <div className="bg-white border-t border-gray-200 p-4 space-y-4">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">תיאור</h4>
                    <p className="text-gray-700 text-sm leading-relaxed">{activity.description}</p>
                  </div>

                  {activity.hebrewNotes && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">הערות בעברית</h4>
                      <p className="text-gray-700 text-sm">{activity.hebrewNotes}</p>
                    </div>
                  )}

                  {activity.policyFocus && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">מוקד מדיניות</h4>
                      <p className="text-gray-700 text-sm">{activity.policyFocus}</p>
                    </div>
                  )}

                  {activity.notes && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">הערות</h4>
                      <p className="text-gray-700 text-sm">{activity.notes}</p>
                    </div>
                  )}

                  <div className="flex gap-4 flex-wrap text-xs">
                    {activity.dataSource && (
                      <div>
                        <span className="text-gray-500">מקור:</span>
                        <span className="text-gray-700 ml-1 font-mono">{activity.dataSource}</span>
                      </div>
                    )}
                    {activity.sourceUrl && (
                      <a
                        href={activity.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        לקרא עוד →
                      </a>
                    )}
                    {activity.budgetAllocation && (
                      <div>
                        <span className="text-gray-500">תקציב:</span>
                        <span className="text-gray-700 ml-1 font-semibold">₪{activity.budgetAllocation.toLocaleString('he-IL')}</span>
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
