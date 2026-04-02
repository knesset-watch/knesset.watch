import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import { getAllCommitteeActivity } from '@/lib/knesset-db';
import { tursoAvailable, getTursoAllCommitteeActivity } from '@/lib/turso-db';
import CommitteesClient from './CommitteesClient';

export default async function CommitteesPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const committees = tursoAvailable()
    ? await getTursoAllCommitteeActivity()
    : getAllCommitteeActivity();
  const totalSessions = committees.reduce((sum, c) => sum + c.sessionCount, 0);

  return <CommitteesClient committees={committees} totalSessions={totalSessions} />;
}
