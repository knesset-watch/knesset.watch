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

  // Merge Turso chunkCount into the richer SQLite session records
  const tursoMap = new Map(tursoCounts.map(s => [s.sessionId, s]));
  const sessions: CommitteeSessionFull[] = localSessions.map(s => {
    const turso = tursoMap.get(s.id);
    return {
      ...s,
      chunkCount: turso?.chunkCount ?? 0,
      protocolUrl: s.protocolUrl ?? turso?.protocolUrl ?? null,
    };
  });

  return <CommitteeClient data={data} sessions={sessions} />;
}
