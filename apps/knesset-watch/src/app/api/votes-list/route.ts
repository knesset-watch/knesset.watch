import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getVoteList, getBillSummaries, dbAvailable } from '@/lib/knesset-db';
import { getVoteListFromTurso } from '@/lib/protocols-db';

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const passedOnly = searchParams.get('passed') === '1';
  const failedOnly = searchParams.get('failed') === '1';
  const maxMarginStr = searchParams.get('maxMargin');
  const maxMargin = maxMarginStr ? parseInt(maxMarginStr, 10) : undefined;
  const search = searchParams.get('q') ?? undefined;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  const opts = { passedOnly, failedOnly, maxMargin, search, limit, offset, from, to };

  try {
    /*
      Turso הוא המקור המעודכן להצבעות: 7,537 שורות עד 28.7.2026, מול 6,358
      עד 25.2.2026 ב-knesset.db המקומי — 1,202 הצבעות שלא הופיעו בממשק.
      הסכמה זהה בשני המסדים.

      התקצירים נשארים מקומיים, כי bill_policy_analysis לא קיימת ב-Turso.
      השלמה אחת לכל עמוד (עד 50 מזהים) ולא שאילתה לכל שורה.
    */
    const turso = await getVoteListFromTurso(opts);

    if (turso) {
      const billIds = turso.votes
        .map(v => v.billId)
        .filter((id): id is number => id !== null);
      const summaries = dbAvailable() ? getBillSummaries(billIds) : new Map<number, string>();

      return NextResponse.json({
        votes: turso.votes.map(v => ({
          ...v,
          billSummary: v.billId !== null ? summaries.get(v.billId) ?? null : null,
        })),
        total: turso.total,
        page,
        limit,
        source: 'turso',
      });
    }

    // Turso לא זמין — הרשימה המקומית, ישנה יותר אבל שלמה
    if (!dbAvailable()) {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 });
    }

    const result = getVoteList(opts);
    return NextResponse.json({ ...result, page, limit, source: 'local' });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
