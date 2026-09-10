import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect, notFound } from 'next/navigation';
import { getCommitteeDetail, getCommitteeSessionsFull, type CommitteeSessionFull } from '@/lib/knesset-db';
import { getCommitteeProtocolSessions } from '@/lib/protocols-db';
import CommitteeClient from './CommitteeClient';

interface Props {
  params: Promise<{ name: string }>;
}

export default async function CommitteePage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);

  const [data, localSessions, tursoCounts] = await Promise.all([
    Promise.resolve(getCommitteeDetail(name)),
    Promise.resolve(getCommitteeSessionsFull(name)),
    getCommitteeProtocolSessions(name),
  ]);
  if (!data) notFound();

  /*
    איחוד שני המקורות, לא העשרה של אחד מהם.

    קודם היה כאן localSessions.map(), ש-Turso רק העשיר. המשמעות הייתה
    שישיבה הקיימת ב-Turso ואין לה מקבילה ב-knesset.db המקומי נשמטה בשקט.
    knesset.db המקומי נעצר ב-24.3.2026 בעוד Turso מגיע ל-8.9.2026, ולכן
    701 ישיבות עם 327,099 תורות דיבור — הגירוד של זויה מ-9.3.26 עד 4.8.26 —
    לא הופיעו בממשק בכלל.

    Turso הוא המקור המעודכן, אז הוא נכנס לרשימה בזכות עצמו. לרשומה מקומית
    יש שדות עשירים יותר (סטטוס, ועדה משותפת, ספירת הצבעות), ולכן היא
    מנצחת כשהיא קיימת.
  */
  const tursoMap = new Map(tursoCounts.map(s => [s.sessionId, s]));
  const localIds = new Set(localSessions.map(s => s.id));

  const enrichedLocal: CommitteeSessionFull[] = localSessions.map(s => {
    const turso = tursoMap.get(s.id);
    return {
      ...s,
      chunkCount: turso?.chunkCount ?? 0,
      protocolUrl: s.protocolUrl ?? turso?.protocolUrl ?? null,
    };
  });

  /** ישיבות שקיימות רק ב-Turso — המטא-דאטה שאין לו נשאר ריק, התמליל קיים */
  const tursoOnly: CommitteeSessionFull[] = tursoCounts
    .filter(t => !localIds.has(t.sessionId))
    .map(t => ({
      id: t.sessionId,
      date: t.date,
      statusDesc: null,
      typeDesc: null,
      isJoint: false,
      sessionNumber: null,
      protocolNumber: null,
      protocolUrl: t.protocolUrl,
      sessionUrl: null,
      noProtocolReason: null,
      startTime: null,
      endTime: null,
      firstAgendaTitle: t.title ?? t.sessionType,
      firstBillTitle: null,
      voteCount: 0,
      linkedBillCount: 0,
      chunkCount: t.chunkCount,
    }));

  const sessions: CommitteeSessionFull[] = [...enrichedLocal, ...tursoOnly]
    .sort((a, b) => b.date.localeCompare(a.date));

  return <CommitteeClient data={data} sessions={sessions} />;
}
