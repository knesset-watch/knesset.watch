'use client';

import Link from 'next/link';
import { OfficeDetail, OfficeActivityJournal } from '@/lib/knesset-db';

interface Props {
  office: OfficeDetail;
  activityJournal?: OfficeActivityJournal | null;
}

const roleTypeColors: Record<string, { badge: string; label: string }> = {
  pm: { badge: 'bg-navy text-white', label: 'ראש ממשלה' },
  'deputy-pm': { badge: 'bg-accent-lit text-accent-ink', label: 'סגן ראש ממשלה' },
  minister: { badge: 'bg-warn-wash text-warn', label: 'שר' },
  deputy: { badge: 'bg-accent-wash text-accent-ink', label: 'סגן שר' },
  acting: { badge: 'bg-surface-2 text-ink-2', label: 'שר בשירות חוקי' },
  other: { badge: 'bg-line text-ink', label: 'אחר' },
};

/*
  12 סוגי שינוי, 12 גוונים. אף אחד לא זוכר ש-cyan הוא הרחבה ו-lime הוא
  הרחבת תפקיד, והתווית ממילא כתובה ליד. שלוש משפחות בלבד, לפי מה שקרה
  בפועל: מינוי, סיום, וכל השאר — אירוע.
*/
const activityTypeColors: Record<string, { badge: string; label: string }> = {
  appointment:        { badge: 'bg-pass-wash text-pass',             label: '✓ מינוי' },
  reappointment:      { badge: 'bg-pass-wash text-pass',             label: '⟲ מינוי חוזר' },
  dismissal:          { badge: 'bg-fail-wash text-fail',             label: '✕ פיטורים' },
  controversy:        { badge: 'bg-fail-wash text-fail',             label: '! מחלוקת' },
  legal_challenge:    { badge: 'bg-fail-wash text-fail',             label: '⚖ משפט' },
  rotation:           { badge: 'bg-surface-2 text-ink-2',            label: '⟳ רוטציה' },
  expansion:          { badge: 'bg-surface-2 text-ink-2',            label: '↗ הרחבה' },
  role_expansion:     { badge: 'bg-surface-2 text-ink-2',            label: '↗ הרחבת תפקיד' },
  portfolio_transfer: { badge: 'bg-surface-2 text-ink-2',            label: '↔ העברת תיקיה' },
  reform:             { badge: 'bg-accent-wash text-accent-ink',     label: '⚡ רפורמה' },
  initiative:         { badge: 'bg-accent-wash text-accent-ink',     label: '◆ יוזמה' },
  policy_launch:      { badge: 'bg-accent-wash text-accent-ink',     label: '◆ מדיניות' },
};

const controversyColors: Record<string, string> = {
  none: 'bg-surface text-ink-2',
  minor: 'bg-warn-wash text-warn',
  moderate: 'bg-warn-wash text-warn',
  major: 'bg-fail-wash text-fail',
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
      <div className="mb-6 text-ui">
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
              <span className="inline-flex items-center px-3 py-1 rounded-full text-ui font-medium bg-pass-wash text-pass">
                ● פעיל
              </span>
            )}
          </div>
        </div>
        {office.shortName && <p className="text-section text-ink-2">{office.shortName}</p>}
        {office.notes && <p className="mt-2 text-ink-2 text-ui">{office.notes}</p>}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 bg-surface p-4 rounded-control">
        <div>
          <p className="text-section font-bold text-ink">{office.distinctHolderCount}</p>
          <p className="text-ui text-ink-2">שרים שכיהנו</p>
        </div>
        <div>
          <p className="text-section font-bold text-ink">{office.timeline.length}</p>
          <p className="text-ui text-ink-2">כהונות</p>
        </div>
        <div>
          <p className="text-ui text-ink-2">מתאריך</p>
          <p className="text-section font-semibold text-ink">
            {office.timeline[0]?.startDate ? formatDate(office.timeline[0].startDate) : '—'}
          </p>
        </div>
      </div>

      {/* Current Holders */}
      {office.currentHolders.length > 0 && (
        <div className="mb-8">
          <h2 className="text-section font-bold text-ink mb-4">שרים נוכחיים</h2>
          <div className="space-y-3">
            {office.currentHolders.map(entry => (
              <div key={entry.positionId} className="bg-pass-wash border border-pass/30 rounded-control p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {entry.personSlug ? (
                      <Link href={`/mk/${entry.personSlug}`} className="text-accent hover:underline font-semibold">
                        {entry.personName}
                      </Link>
                    ) : (
                      <span className="font-semibold">{entry.personName}</span>
                    )}
                    <span className={`text-meta font-semibold px-2 py-1 rounded-full ${roleTypeColors[entry.roleType]?.badge}`}>
                      {roleTypeColors[entry.roleType]?.label}
                    </span>
                  </div>
                  {entry.factionName && (
                    <span className="text-ui text-ink-2">
                      <Link href={`/faction/${encodeURIComponent(entry.factionName)}`} className="text-accent hover:underline">
                        {entry.factionName}
                      </Link>
                    </span>
                  )}
                </div>
                <p className="text-ui text-ink-2 mt-2">מתאריך {formatDate(entry.startDate)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="mb-8">
        <h2 className="text-section font-bold text-ink mb-4">ציר זמן של כהונות</h2>
        <div className="space-y-3">
          {office.timeline.map((entry, idx) => (
            <div
              key={entry.positionId}
              className={`border rounded-control p-4 ${entry.isCurrent ? 'border-pass/30 bg-pass-wash' : 'border-line bg-surface'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-meta font-semibold px-2 py-1 rounded-full ${roleTypeColors[entry.roleType]?.badge}`}>
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
                  <p className="text-ui text-ink-2">
                    {formatDate(entry.startDate)} {entry.finishDate ? `– ${formatDate(entry.finishDate)}` : '– כיום'}
                    {entry.durationDays && ` · ${entry.durationDays} ימים`}
                  </p>
                  {entry.factionName && (
                    <p className="text-ui text-ink-2 mt-1">
                      <Link href={`/faction/${encodeURIComponent(entry.factionName)}`} className="text-accent hover:underline">
                        {entry.factionName}
                      </Link>
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {entry.governmentNum && (
                    <p className="text-meta font-semibold text-mute">
                      {govLabels[entry.governmentNum] || `ממשלה ${entry.governmentNum}`}
                    </p>
                  )}
                  {entry.isCurrent && <p className="text-meta font-semibold text-pass mt-1">● נוכחי</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity Journal */}
      {activityJournal && activityJournal.activities.length > 0 && (
        <div className="mb-8">
          <h2 className="text-section font-bold text-ink mb-4">רישום פעילות משרדי</h2>
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-ui">
            <div className="bg-accent-wash p-3 rounded border border-line">
              <p className="font-semibold text-accent-ink">{activityJournal.totalEntries}</p>
              <p className="text-accent text-meta">סך פעילויות</p>
            </div>
            <div className="bg-fail-wash p-3 rounded border border-fail/30">
              <p className="font-semibold text-fail">{activityJournal.controversyStats.major}</p>
              <p className="text-fail text-meta">מחלוקות גדולות</p>
            </div>
            <div className="bg-warn-wash p-3 rounded border border-warn/30">
              <p className="font-semibold text-warn">{activityJournal.controversyStats.moderate + activityJournal.controversyStats.minor}</p>
              <p className="text-warn text-meta">מחלוקות קלות/בינוניות</p>
            </div>
            <div className="bg-surface p-3 rounded border border-line">
              <p className="font-semibold text-ink">{Object.keys(activityJournal.activityTypeStats).length}</p>
              <p className="text-ink-2 text-meta">סוגי פעילות</p>
            </div>
          </div>

          <div className="space-y-3">
            {activityJournal.activities.map(activity => (
              <details
                key={activity.id}
                className="border rounded-control overflow-hidden transition-all"
              >
                <summary className={`cursor-pointer p-4 flex items-start justify-between gap-4 select-none ${controversyColors[activity.controversyLevel] || 'bg-surface'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-meta font-semibold px-2 py-1 rounded-full flex-shrink-0 ${activityTypeColors[activity.activityType]?.badge || 'bg-line'}`}>
                        {activityTypeColors[activity.activityType]?.label || activity.activityType}
                      </span>
                      {activity.controversyLevel !== 'none' && (
                        <span className="text-meta font-semibold px-2 py-1 rounded-full bg-surface border">
                          {activity.controversyLevel === 'major' && '⚠️ משמעותי'}
                          {activity.controversyLevel === 'moderate' && '⚠️ בינוני'}
                          {activity.controversyLevel === 'minor' && '⚠️ קל'}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-ink">{activity.activityTitle}</h3>
                    <p className="text-ui text-ink-2 mt-1">
                      {formatDate(activity.activityDate)}
                      {activity.affectedPersonName && ` · ${activity.affectedPersonName}`}
                      {activity.coalitionParty && ` · ${activity.coalitionParty}`}
                    </p>
                  </div>
                  <div className="text-right text-meta text-mute flex-shrink-0">
                    ثقة: {activity.confidenceLevel}%
                  </div>
                </summary>

                <div className="bg-surface border-t border-line p-4 space-y-4">
                  <div>
                    <h4 className="font-semibold text-ink mb-2">תיאור</h4>
                    <p className="text-ink-2 text-ui leading-relaxed">{activity.description}</p>
                  </div>

                  {activity.hebrewNotes && (
                    <div>
                      <h4 className="font-semibold text-ink mb-2">הערות בעברית</h4>
                      <p className="text-ink-2 text-ui">{activity.hebrewNotes}</p>
                    </div>
                  )}

                  {activity.policyFocus && (
                    <div>
                      <h4 className="font-semibold text-ink mb-2">מוקד מדיניות</h4>
                      <p className="text-ink-2 text-ui">{activity.policyFocus}</p>
                    </div>
                  )}

                  {activity.notes && (
                    <div>
                      <h4 className="font-semibold text-ink mb-2">הערות</h4>
                      <p className="text-ink-2 text-ui">{activity.notes}</p>
                    </div>
                  )}

                  <div className="flex gap-4 flex-wrap text-meta">
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
