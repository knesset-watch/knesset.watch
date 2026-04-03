import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { tursoAvailable, getTursoAllCommitteeActivity } from '@/lib/turso-db';
import { getAllCommitteeActivity } from '@/lib/knesset-db';

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const from = req.nextUrl.searchParams.get('from') ?? undefined;
  const to   = req.nextUrl.searchParams.get('to')   ?? undefined;

  try {
    const committees = tursoAvailable()
      ? await getTursoAllCommitteeActivity(from, to)
      : getAllCommitteeActivity();          // SQLite fallback (no date filter)
    const totalSessions = committees.reduce((sum, c) => sum + c.sessionCount, 0);
    return NextResponse.json({ committees, totalSessions });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('committees/activity error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
