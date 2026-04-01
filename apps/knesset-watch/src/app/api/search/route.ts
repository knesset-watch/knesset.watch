import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable, searchAll, searchSessions } from '@/lib/knesset-db';
import { searchProtocols, protocolsDbAvailable } from '@/lib/protocols-db';

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (q.length < 2) return NextResponse.json({ results: [] });
  if (q.length > 100) return NextResponse.json({ error: 'שאילתה ארוכה מדי' }, { status: 400 });

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  try {
    const results = searchAll(q);

    // Add session title matches from local SQLite
    const sessionRows = searchSessions(q, 10);
    for (const s of sessionRows) {
      results.push({
        type: 'session',
        id: String(s.id),
        title: s.title ?? s.committeeName ?? `ישיבה ${s.id}`,
        subtitle: s.committeeName ?? null,
        url: `/session/${s.id}`,
      });
    }

    // Add protocol text matches from Turso if available
    if (protocolsDbAvailable()) {
      try {
        const proto = await searchProtocols(q, null, 1);
        for (const r of proto.results.slice(0, 5)) {
          // Avoid duplicating sessions already found by title search
          if (!results.find(x => x.type === 'session' && x.id === String(r.sessionId))) {
            results.push({
              type: 'session',
              id: String(r.sessionId),
              title: r.title ?? r.committeeName ?? `ישיבה ${r.sessionId}`,
              subtitle: r.committeeName ?? null,
              url: `/session/${r.sessionId}`,
            });
          }
        }
      } catch {
        // Protocol search failure is non-fatal
      }
    }

    return NextResponse.json({ results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Search error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
