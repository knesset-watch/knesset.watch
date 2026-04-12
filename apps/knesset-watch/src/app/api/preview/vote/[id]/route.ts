import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { id } = await params;
  const voteId = parseInt(id, 10);
  if (isNaN(voteId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const vote = db.prepare(`
      SELECT title, date, is_passed, total_for, total_against, total_abstain, macro_agenda
      FROM plenary_vote WHERE id = ?
    `).get(voteId) as {
      title: string; date: string; is_passed: number;
      total_for: number; total_against: number; total_abstain: number;
      macro_agenda: string | null;
    } | undefined;

    if (!vote) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json({
      title: vote.title,
      date: vote.date.slice(0, 10),
      isPassed: vote.is_passed === 1,
      totalFor: vote.total_for,
      totalAgainst: vote.total_against,
      totalAbstain: vote.total_abstain,
      macroAgenda: vote.macro_agenda,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    db?.close();
  }
}
