import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getSessionDetail, getSessionSpeakerTurns } from '@/lib/knesset-db';
import { tursoAvailable, getTursoSessionDetail, getTursoSessionSpeakerTurns } from '@/lib/turso-db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { sessionId: raw } = await params;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  const [session, turns] = tursoAvailable()
    ? await Promise.all([
        getTursoSessionDetail(sessionId),
        getTursoSessionSpeakerTurns(sessionId),
      ])
    : [getSessionDetail(sessionId), getSessionSpeakerTurns(sessionId)];

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json({ session, turns });
}
