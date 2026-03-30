import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET() {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    // Get distinct macro agendas from bills and votes
    const bills = db.prepare(`
      SELECT macro_agenda as id, COUNT(*) as billCount
      FROM bill
      WHERE macro_agenda IS NOT NULL
      GROUP BY macro_agenda
    `).all() as any[];

    const votes = db.prepare(`
      SELECT macro_agenda as id, COUNT(*) as voteCount
      FROM plenary_vote
      WHERE macro_agenda IS NOT NULL
      GROUP BY macro_agenda
    `).all() as any[];

    const agendaMap = new Map<string, any>();

    for (const b of bills) {
      agendaMap.set(b.id, { id: b.id, label: b.id, billCount: b.billCount, voteCount: 0 });
    }

    for (const v of votes) {
      if (!agendaMap.has(v.id)) {
        agendaMap.set(v.id, { id: v.id, label: v.id, billCount: 0, voteCount: v.voteCount });
      } else {
        agendaMap.get(v.id).voteCount = v.voteCount;
      }
    }

    const agendas = Array.from(agendaMap.values()).sort((a, b) => (b.billCount + b.voteCount) - (a.billCount + a.voteCount));

    return NextResponse.json({ agendas });
  } catch (error: any) {
    console.error('Agendas DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
