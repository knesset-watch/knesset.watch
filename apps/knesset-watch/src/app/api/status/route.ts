import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { createClient } from '@libsql/client/http';

function getTurso() {
  if (!process.env.TURSO_URL) return null;
  return createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
}

function n(res: { rows: Array<Record<string, unknown>> }) {
  return Number(res.rows[0]?.n ?? 0);
}

export async function GET() {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const db = getTurso();
  if (!db) return NextResponse.json({ error: 'Turso not configured' }, { status: 503 });

  const [
    plenaryTotal,
    plenaryScraped,
    plenaryReparsed,
    plenaryTurns,
    plenaryTurnsWithMk,
    plenaryTurnsEmbedded,
    committeeTurns,
    // Count IS NULL (uses partial index) instead of IS NOT NULL (full blob scan)
    committeeTurnsNull,
  ] = await Promise.all([
    db.execute('SELECT COUNT(*) as n FROM plenary_session'),
    db.execute('SELECT COUNT(*) as n FROM plenary_session WHERE last_scraped IS NOT NULL'),
    db.execute('SELECT COUNT(*) as n FROM plenary_session WHERE reparsed_at IS NOT NULL'),
    db.execute('SELECT COUNT(*) as n FROM plenary_speaker_turn'),
    db.execute('SELECT COUNT(*) as n FROM plenary_speaker_turn WHERE mk_id IS NOT NULL'),
    db.execute('SELECT COUNT(*) as n FROM plenary_speaker_turn WHERE embedding IS NOT NULL'),
    db.execute('SELECT COUNT(*) as n FROM session_speaker_turn'),
    db.execute('SELECT COUNT(*) as n FROM session_speaker_turn WHERE embedding IS NULL'),
  ]);

  const committeeTurnsTotal = n(committeeTurns);
  const committeeTurnsEmbedded = committeeTurnsTotal - n(committeeTurnsNull);

  return NextResponse.json({
    plenary: {
      sessions: {
        total: n(plenaryTotal),
        scraped: n(plenaryScraped),
        reparsed: n(plenaryReparsed),
      },
      turns: {
        total: n(plenaryTurns),
        mk_matched: n(plenaryTurnsWithMk),
        embedded: n(plenaryTurnsEmbedded),
      },
    },
    committee: {
      turns: {
        total: committeeTurnsTotal,
        embedded: committeeTurnsEmbedded,
      },
    },
    timestamp: new Date().toISOString(),
  });
}
