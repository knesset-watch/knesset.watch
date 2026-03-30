import { NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const personIdStr = searchParams.get('personId');

  if (!personIdStr) {
    return NextResponse.json({ error: 'Person ID is required' }, { status: 400 });
  }
  const personId = parseInt(personIdStr, 10);

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    // Fetch all K25 bills for this person
    const bills = db.prepare(`
      SELECT b.id, b.title, b.is_passed, b.committee_name, b.macro_agenda, b.micro_agenda
      FROM bill b
      JOIN bill_initiator i ON i.bill_id = b.id
      WHERE i.mk_id = ?
      ORDER BY b.id DESC
    `).all(personId) as any[];

    const totalProposed = bills.length;
    const passedBills = bills.filter(b => b.is_passed);

    return NextResponse.json({
      personId,
      stats: {
        proposed: totalProposed,
        passed: passedBills.length,
        conversionRate: totalProposed > 0 ? ((passedBills.length / totalProposed) * 100).toFixed(1) : "0"
      },
      bills: bills.map(b => ({
        id: b.id,
        name: b.title,
        status: b.is_passed ? 'סופי' : 'הוגש',
        date: '', // DB doesn't currently store bill date, only last updated. We could add it.
        macroAgenda: b.macro_agenda,
        microAgenda: b.micro_agenda,
        committee: b.committee_name
      })),
      source: 'db'
    });
  } catch (error: any) {
    console.error('Track record DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
