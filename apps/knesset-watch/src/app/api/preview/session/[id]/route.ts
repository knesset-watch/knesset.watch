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
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const session = db.prepare(`
      SELECT cs.committee_name, cs.title, cs.date,
        (SELECT COUNT(*) FROM session_agenda_item WHERE session_id = cs.id) as agenda_count,
        (SELECT COUNT(*) FROM committee_attendance WHERE session_id = cs.id) as attendee_count,
        (SELECT COUNT(*) FROM session_vote WHERE session_id = cs.id) as vote_count,
        (SELECT COUNT(*) FROM session_bill WHERE session_id = cs.id) as bill_count
      FROM committee_session cs WHERE cs.id = ?
    `).get(sessionId) as {
      committee_name: string | null; title: string | null; date: string;
      agenda_count: number; attendee_count: number; vote_count: number; bill_count: number;
    } | undefined;

    if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json({
      committeeName: session.committee_name ?? '',
      title: session.title,
      date: session.date.slice(0, 10),
      agendaCount: session.agenda_count,
      attendeeCount: session.attendee_count,
      voteCount: session.vote_count,
      billCount: session.bill_count,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    db?.close();
  }
}
