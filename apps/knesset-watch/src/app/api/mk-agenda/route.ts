import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

const CODE_TO_DESC: Record<number, string> = {
  6: 'נוכח', 7: 'בעד', 8: 'נגד', 9: 'נמנע',
};

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const mkIdStr = searchParams.get('mkId');

  if (!mkIdStr || !/^\d+$/.test(mkIdStr)) {
    return NextResponse.json({ error: 'mkId required' }, { status: 400 });
  }
  const mkId = parseInt(mkIdStr, 10);

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    // Group MK votes by macro agenda
    const rows = db.prepare(`
      SELECT 
        pv.macro_agenda as topicId, 
        pv.macro_agenda as label,
        r.result_code as resultCode,
        pv.id as voteId,
        pv.title,
        pv.date
      FROM mk_vote_result r
      JOIN plenary_vote pv ON pv.id = r.vote_id
      WHERE r.mk_id = ? AND pv.macro_agenda IS NOT NULL
      ORDER BY pv.macro_agenda, pv.date DESC
    `).all(mkId) as any[];

    const topicsMap = new Map<string, any>();

    for (const row of rows) {
      if (!topicsMap.has(row.topicId)) {
        topicsMap.set(row.topicId, {
          topicId: row.topicId,
          label: row.label,
          votes: []
        });
      }
      topicsMap.get(row.topicId).votes.push({
        voteId: row.voteId,
        title: row.title,
        date: row.date,
        result: CODE_TO_DESC[row.resultCode] || 'נוכח'
      });
    }

    const topics = Array.from(topicsMap.values()).sort((a, b) => b.votes.length - a.votes.length);

    return NextResponse.json({ topics, fromDb: true, lastFetched: Date.now() });

  } catch (error: any) {
    console.error('MK agenda DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
