import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? null;
  const to   = url.searchParams.get('to')   ?? null;

  const db = new Database(DB_PATH, { readonly: true });

  try {
    const dateFilter = from && to
      ? 'AND publication_date >= ? AND publication_date <= ?'
      : from ? 'AND publication_date >= ?'
      : to   ? 'AND publication_date <= ?'
      : '';
    const dateArgs = [from, to].filter(Boolean) as string[];

    const bills = db.prepare(`
      SELECT id, title, publication_date, macro_agenda, micro_agenda
      FROM bill
      WHERE is_passed = 1 AND publication_date IS NOT NULL ${dateFilter}
      ORDER BY publication_date DESC, id DESC
      LIMIT 8
    `).all(...dateArgs) as any[];

    return NextResponse.json({
      count: bills.length,
      bills: bills.map(b => ({
        id: b.id,
        title: b.title,
        date: b.publication_date,
        macroAgenda: b.macro_agenda,
        microAgenda: b.micro_agenda
      })),
      source: 'db'
    });
  } catch (error: any) {
    console.error('Pulse DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
