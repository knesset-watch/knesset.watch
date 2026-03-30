import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET() {
  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    // Dynamic date 30 days ago
    const date = new Date();
    date.setDate(date.getDate() - 30);
    const thirtyDaysAgo = date.toISOString().split('T')[0];

    // Filter for bills with publication_date in last 30 days
    const bills = db.prepare(`
      SELECT id, title, publication_date, macro_agenda, micro_agenda
      FROM bill
      WHERE is_passed = 1 AND publication_date >= ?
      ORDER BY publication_date DESC, id DESC
    `).all(thirtyDaysAgo) as any[];

    return NextResponse.json({
      count: bills.length,
      timeframe: '30 days',
      latestBills: bills.slice(0, 5).map(b => b.title),
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
