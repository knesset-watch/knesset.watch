import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect, notFound } from 'next/navigation';
import { getCommitteeDetail } from '@/lib/knesset-db';
import { tursoAvailable, getTursoCommitteeDetail } from '@/lib/turso-db';
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

  const [data, protocolSessions] = await Promise.all([
    tursoAvailable() ? getTursoCommitteeDetail(name) : Promise.resolve(getCommitteeDetail(name)),
    getCommitteeProtocolSessions(name),
  ]);
  if (!data) notFound();

  return <CommitteeClient data={data} protocolSessions={protocolSessions} />;
}
