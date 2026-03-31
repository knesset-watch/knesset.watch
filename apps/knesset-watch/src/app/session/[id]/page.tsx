import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect, notFound } from 'next/navigation';
import { getSessionDetail, getSessionSpeakerTurns } from '@/lib/knesset-db';
import SessionClient from './SessionClient';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const { id: rawId } = await params;
  const sessionId = parseInt(rawId, 10);
  if (isNaN(sessionId)) notFound();

  const session = getSessionDetail(sessionId);
  if (!session) notFound();

  const turns = getSessionSpeakerTurns(sessionId);

  return <SessionClient session={session} turns={turns} />;
}
