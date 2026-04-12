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
  const billId = parseInt(id, 10);
  if (isNaN(billId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const bill = db.prepare(`
      SELECT b.title, b.is_passed, b.status_desc, b.committee_name, b.macro_agenda, b.init_date,
             COUNT(bi.mk_id) as initiator_count
      FROM bill b
      LEFT JOIN bill_initiator bi ON bi.bill_id = b.id
      WHERE b.id = ?
      GROUP BY b.id
    `).get(billId) as {
      title: string; is_passed: number; status_desc: string | null;
      committee_name: string | null; macro_agenda: string | null;
      init_date: string | null; initiator_count: number;
    } | undefined;

    if (!bill) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json({
      title: bill.title,
      isPassed: bill.is_passed === 1,
      statusDesc: bill.status_desc,
      committeeName: bill.committee_name,
      macroAgenda: bill.macro_agenda,
      initDate: bill.init_date?.slice(0, 10) ?? null,
      initiatorCount: bill.initiator_count,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    db?.close();
  }
}
