'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SessionDetail, SpeakerTurn } from '@/lib/knesset-db';

// Strip "היו"ר " / "יו"ר " / "מ"מ יו"ר " prefix from speaker names and return a role override
function normalizeRolePrefix(name: string | null): { name: string | null; roleOverride: string | null } {
  if (!name) return { name: null, roleOverride: null };
  if (name.startsWith('היו"ר ') || name.startsWith('היו״ר ')) return { name: name.replace(/^ה?יו["״]ר /, '').trim(), roleOverride: 'chair' };
  if (name.startsWith('מ"מ יו"ר ') || name.startsWith('מ״מ יו״ר ')) return { name: name.replace(/^מ["״]מ יו["״]ר /, '').trim(), roleOverride: 'deputy_chair' };
  if (name.startsWith('יו"ר ') || name.startsWith('יו״ר ')) return { name: name.replace(/^יו["״]ר /, '').trim(), roleOverride: 'chair' };
  return { name, roleOverride: null };
}

function RoleBadge({ role }: { role: string }) {
  const labels: Record<string, string> = {
    chair: 'יו"ר',
    deputy_chair: 'מ"מ',
    member: 'ח"כ',
    visitor: 'מוזמן',
    minister: 'שר',
    guest: 'אורח',
  };
  const label = labels[role] ?? role;
  const colors: Record<string, string> = {
    chair: 'bg-black text-white',
    deputy_chair: 'bg-gray-700 text-white',
    minister: 'bg-purple-100 text-purple-800 border border-purple-200',
    visitor: 'bg-blue-50 text-blue-700 border border-blue-200',
    member: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${colors[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

export default function SessionClient({
  session,
  turns,
}: {
  session: SessionDetail;
  turns: SpeakerTurn[];
}) {
  const router = useRouter();
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);

  const displayDate = new Date(session.date).toLocaleDateString('he-IL', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const timeRange = session.startTime
    ? `${session.startTime}${session.endTime ? `–${session.endTime}` : ''}`
    : null;

  // Turns with actual text content
  const turnsWithText = useMemo(() => turns.filter(t => t.text && t.text.length > 5), [turns]);
  const hasTranscript = turnsWithText.length > 0;

  // Build display rows directly from turns (data is clean from the parser)
  const allDisplayTurns = useMemo(() => turnsWithText.map(t => {
    const { name, roleOverride } = normalizeRolePrefix(t.rawName);
    return {
      key: String(t.turnNumber),
      speakerName: name ?? t.rawName ?? '',
      mkId: t.mkId ?? null,
      slug: t.slug ?? null,
      speakerRole: roleOverride ?? t.speakerRole ?? null,
      text: t.text,
    };
  }), [turnsWithText]);

  // Unique speakers for filter dropdown
  const speakers = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const dt of allDisplayTurns) {
      if (dt.speakerName && !seen.has(dt.speakerName)) {
        seen.add(dt.speakerName);
        result.push(dt.speakerName);
      }
    }
    return result;
  }, [allDisplayTurns]);

  // For no-transcript mode: unique speakers from raw turns
  const rawSpeakers = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ name: string; mkId: number | null; slug: string | null }> = [];
    for (const t of turns) {
      const { name } = normalizeRolePrefix(t.rawName);
      const speaker = name ?? t.rawName;
      if (speaker && !seen.has(speaker)) {
        seen.add(speaker);
        result.push({ name: speaker, mkId: t.mkId ?? null, slug: t.slug ?? null });
      }
    }
    return result;
  }, [turns]);

  const displayTurns = speakerFilter
    ? allDisplayTurns.filter(dt => dt.speakerName === speakerFilter)
    : allDisplayTurns;

  const chairMember = session.members.find(m => m.role === 'chair');
  const headingTitle = session.agenda[0]?.title ?? session.title;

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Back */}
        <button
          onClick={() => router.back()}
          className="text-sm font-black text-gray-400 hover:text-black transition-colors mb-6"
        >
          → חזרה
        </button>

        {/* Breadcrumb */}
        <div className="text-xs text-gray-400 mb-2">
          {session.committeeName && (
            <>
              <Link
                href={`/committee/${encodeURIComponent(session.committeeName)}`}
                className="font-bold hover:text-black transition-colors"
              >
                {session.committeeName}
              </Link>
              <span className="mx-2">·</span>
            </>
          )}
          <span>{displayDate}</span>
          {session.protocolNumber && <span className="mx-2">· ישיבה {session.protocolNumber}</span>}
        </div>

        {/* Title */}
        {headingTitle && (
          <h1 className="text-2xl font-black leading-tight mb-3">{headingTitle}</h1>
        )}

        {/* Stat pills */}
        <div className="flex flex-wrap gap-2 mb-8">
          {(session.members.length + session.guests.length) > 0 && (
            <span className="text-[11px] font-black px-3 py-1 rounded-full bg-gray-100 text-gray-600">
              {session.members.length + session.guests.length} נוכחים
            </span>
          )}
          {session.votes.length > 0 && (
            <span className="text-[11px] font-black px-3 py-1 rounded-full bg-gray-100 text-gray-600">
              {session.votes.length} הצבעות
            </span>
          )}
          {session.agenda.length > 0 && (
            <span className="text-[11px] font-black px-3 py-1 rounded-full bg-gray-100 text-gray-600">
              {session.agenda.length} נושאים
            </span>
          )}
          {timeRange && (
            <span className="text-[11px] font-black px-3 py-1 rounded-full bg-gray-100 text-gray-600">
              {timeRange}
            </span>
          )}
          {chairMember && (
            <span className="text-[11px] font-black px-3 py-1 rounded-full bg-black text-white">
              יו&quot;ר: {chairMember.name}
            </span>
          )}
        </div>

        {/* Participants */}
        {session.members.length > 0 && (
          <div className="rounded-2xl border border-black/8 p-5 mb-5">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">חברי ועדה</div>
            <div className="flex flex-wrap gap-1.5">
              {session.members.map(m => (
                <div key={m.mkId} className="flex items-center gap-1">
                  {m.slug || m.mkId ? (
                    <Link
                      href={`/mk/${m.slug ?? m.mkId}`}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-800 hover:bg-gray-200 transition-colors"
                    >
                      {m.name}
                    </Link>
                  ) : (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
                      {m.name}
                    </span>
                  )}
                  {m.role !== 'member' && <RoleBadge role={m.role} />}
                </div>
              ))}
            </div>

            {session.guests.length > 0 && (
              <div className="mt-4 pt-4 border-t border-black/5">
                <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">מוזמנים</div>
                <div className="flex flex-col gap-1">
                  {session.guests.map((g, i) => (
                    <div key={i} className="text-xs text-gray-600">
                      <span className="font-bold">{g.name}</span>
                      {(g.role || g.organization) && (
                        <span className="text-gray-400">
                          {g.role && ` – ${g.role}`}
                          {g.organization && ` – ${g.organization}`}
                        </span>
                      )}
                      {g.method === 'online' && (
                        <span className="mr-1 text-[9px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">מרחוק</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {session.staff.length > 0 && (
              <div className="mt-4 pt-4 border-t border-black/5">
                <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">צוות</div>
                <div className="flex flex-col gap-1">
                  {session.staff.map((s, i) => {
                    const roleLabel: Record<string, string> = {
                      legal_counsel: 'ייעוץ משפטי',
                      manager: 'מנהל/ת הוועדה',
                      writer: 'רישום פרלמנטרי',
                      translator: 'תרגום',
                    };
                    return (
                      <div key={i} className="text-xs text-gray-600">
                        <span className="font-bold">{s.name}</span>
                        <span className="text-gray-400"> – {roleLabel[s.role] ?? s.role}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Agenda */}
        {session.agenda.length > 0 && (
          <div className="rounded-2xl border border-black/8 p-5 mb-5">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">סדר היום</div>
            <ol className="flex flex-col gap-2 list-decimal list-inside">
              {session.agenda.map((item, i) => (
                <li key={i} className="text-sm text-gray-800 leading-snug">
                  {item.title}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Votes */}
        {session.votes.length > 0 && (
          <div className="rounded-2xl border border-black/8 p-5 mb-5">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">הצבעות</div>
            <div className="flex flex-col gap-2">
              {session.votes.map((v, i) => {
                const fallbackTitle = !v.subject && session.agenda.length === 1
                  ? session.agenda[0].title
                  : null;
                return (
                  <div key={i} className="flex items-start gap-3">
                    <span className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full mt-0.5 ${
                      v.passed === true ? 'bg-teal-500 text-white'
                      : v.passed === false ? 'bg-red-100 text-red-700'
                      : 'bg-gray-200 text-gray-500'
                    }`}>
                      {v.passed === true ? 'אושר' : v.passed === false ? 'נדחה' : 'הצבעה'}
                    </span>
                    <div className="flex-1 min-w-0">
                      {v.subject ? (
                        <p className="text-sm font-bold text-gray-900 leading-snug">{v.subject}</p>
                      ) : fallbackTitle ? (
                        <p className="text-sm font-bold text-gray-500 leading-snug">{fallbackTitle}</p>
                      ) : (
                        <p className="text-sm text-gray-400 leading-snug">הצבעה {v.voteNumber}</p>
                      )}
                      {(v.forCount > 0 || v.againstCount > 0) && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {v.forCount} בעד · {v.againstCount} נגד{v.abstainCount > 0 ? ` · ${v.abstainCount} נמנע` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bills */}
        {session.bills.length > 0 && (
          <div className="rounded-2xl border border-black/8 p-5 mb-5">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">חקיקה</div>
            <div className="flex flex-col gap-1">
              {session.bills.map(b => (
                <div key={b.billId} className="text-sm text-gray-700">
                  {b.title ?? `הצ"ח ${b.billId}`}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Speaker Turns */}
        {turns.length > 0 && (
          <div className="rounded-2xl border border-black/8 p-5 mb-5">
            {hasTranscript ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide">
                    דיון
                    {speakerFilter && (
                      <span className="mr-2 text-black normal-case">
                        — {displayTurns.length} דברי {speakerFilter}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={speakerFilter ?? ''}
                      onChange={e => setSpeakerFilter(e.target.value || null)}
                      className="text-xs font-bold px-3 py-1.5 rounded-full border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30 min-w-[140px]"
                      dir="rtl"
                    >
                      <option value="">כל הדוברים</option>
                      {speakers.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    {speakerFilter && (
                      <button
                        onClick={() => setSpeakerFilter(null)}
                        className="text-[10px] font-black text-gray-400 hover:text-black transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1 max-h-[70vh] overflow-y-auto">
                  {displayTurns.map((dt, idx) => {
                    const prev = displayTurns[idx - 1];
                    const showSpeaker = !prev || prev.speakerName !== dt.speakerName || prev.speakerRole !== dt.speakerRole;
                    return (
                      <div key={dt.key} className={`flex gap-3 ${showSpeaker && idx > 0 ? 'mt-4' : ''}`}>
                        <div className="shrink-0 w-28 flex flex-col items-end gap-1 pt-0.5">
                          {showSpeaker && (
                            <>
                              {dt.mkId ? (
                                <Link
                                  href={`/mk/${dt.slug ?? dt.mkId}`}
                                  className="text-[11px] font-black text-teal-700 hover:underline text-left leading-tight"
                                >
                                  {dt.speakerName}
                                </Link>
                              ) : (
                                <span className="text-[11px] font-black text-gray-600 text-left leading-tight">
                                  {dt.speakerName}
                                </span>
                              )}
                              {dt.speakerRole && dt.speakerRole !== 'member' && (
                                <RoleBadge role={dt.speakerRole} />
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">{dt.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">
                  דוברים ({rawSpeakers.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rawSpeakers.map(s => (
                    s.mkId ? (
                      <Link
                        key={s.name}
                        href={`/mk/${s.slug ?? s.mkId}`}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-800 hover:bg-gray-200 transition-colors"
                      >
                        {s.name}
                      </Link>
                    ) : (
                      <span
                        key={s.name}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700"
                      >
                        {s.name}
                      </span>
                    )
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-3">תמליל הישיבה אינו זמין</p>
              </>
            )}
          </div>
        )}

        {/* Documents */}
        {session.documents.length > 0 && (
          <div className="rounded-2xl border border-black/8 p-5 mb-5">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">מסמכים</div>
            <div className="flex flex-col gap-2">
              {session.documents.filter(d => d.type === 'protocol').map(d => (
                <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm font-bold text-teal-700 hover:text-teal-900">
                  <span className="text-[10px] font-black bg-teal-50 border border-teal-200 text-teal-700 px-2 py-0.5 rounded-full shrink-0">פרוטוקול</span>
                  {d.name}
                </a>
              ))}
              {session.documents.filter(d => d.type !== 'protocol').map(d => (
                <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-gray-600 hover:text-black">
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full shrink-0">{d.appDesc ?? 'מסמך'}</span>
                  {d.name}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
