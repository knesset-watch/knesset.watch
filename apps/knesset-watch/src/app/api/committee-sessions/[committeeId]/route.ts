import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getCommitteeSessions } from '@/lib/knesset-db';
import { tursoAvailable, getTursoCommitteeSessions } from '@/lib/turso-db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ committeeId: string }> },
) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { committeeId: raw } = await params;
  const committeeId = parseInt(raw, 10);
  if (isNaN(committeeId)) {
    return NextResponse.json({ error: 'Invalid committee ID' }, { status: 400 });
  }

  const sessions = tursoAvailable()
    ? await getTursoCommitteeSessions(committeeId, 200)
    : getCommitteeSessions(committeeId, 200);

  return NextResponse.json({ sessions });
}
