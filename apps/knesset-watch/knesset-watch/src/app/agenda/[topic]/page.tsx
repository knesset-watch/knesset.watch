import { checkServerAuth } from '@minimal-db/ui/auth-utils';
import { redirect } from 'next/navigation';
import AgendaTopicClient from './AgendaTopicClient';

interface Props {
  params: Promise<{ topic: string }>;
}

export default async function AgendaTopicPage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) {
    redirect('/login');
  }

  const { topic } = await params;
  return <AgendaTopicClient topic={topic} />;
}
