import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
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
      SELECT b.id, b.title, b.is_passed, b.status_id, b.committee_name,
             a.overall_summary AS summary
      FROM bill b
      JOIN bill_initiator i ON i.bill_id = b.id
      LEFT JOIN bill_policy_analysis a ON a.bill_id = b.id
      WHERE i.mk_id = ?
      ORDER BY b.is_passed DESC, b.id DESC
    `).all(personId) as Array<{ id: number; title: string; is_passed: number; status_id: number | null; committee_name: string | null; summary: string | null }>;

    const totalProposed = bills.length;
    const passedBills = bills.filter(b => b.is_passed);

    return NextResponse.json({
      personId,
      stats: {
        proposed: totalProposed,
        passed: passedBills.length,
        conversionRate: totalProposed > 0 ? ((passedBills.length / totalProposed) * 100).toFixed(1) : "0"
      },
      /*
        השדה date הוסר. הוא הוחזר כמחרוזת ריקה, והעמוד הריץ עליו
        new Date("") — כך שכל שורה בטבלה הציגה "Invalid Date".
        bill.init_date ריק בכל 7,296 השורות ואין ממה לגזור תאריך.

        macro_agenda ו-micro_agenda הוסרו גם הם: שניהם NULL בכל השורות.
      */
      bills: bills.map(b => ({
        id: b.id,
        name: b.title,
        isPassed: !!b.is_passed,
        statusId: b.status_id ?? null,
        summary: b.summary ? String(b.summary).trim() : null,
        committee: b.committee_name,
      })),
      source: 'db'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Track record DB error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    db.close();
  }
}
