import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect, notFound } from 'next/navigation';
import { getSessionDetail, getSessionSpeakerTurns } from '@/lib/knesset-db';
import { tursoAvailable, getTursoSessionDetail, getTursoSessionSpeakerTurns } from '@/lib/turso-db';
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

  const [session, turns] = tursoAvailable()
    ? await Promise.all([getTursoSessionDetail(sessionId), getTursoSessionSpeakerTurns(sessionId)])
    : [getSessionDetail(sessionId), getSessionSpeakerTurns(sessionId)];

  if (!session) notFound();

  return <SessionClient session={session} turns={turns} />;
}
