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
    // Aggregating bills by committee
    const committees = db.prepare(`
      SELECT
        committee_name as name,
        COUNT(*) as billCount,
        SUM(is_passed) as passedCount,
        macro_agenda as primaryAgenda
      FROM bill
      WHERE committee_name IS NOT NULL
      GROUP BY committee_name
      ORDER BY billCount DESC
    `).all() as any[];

    // Member counts + member list from mk_position (current only)
    const memberRows = db.prepare(`
      SELECT pos.committee, mp.person_id as id, mp.first_name || ' ' || mp.last_name as name, mp.slug, mp.is_coalition as isCoalition
      FROM mk_position pos
      JOIN mk_person mp ON mp.person_id = pos.mk_id
      WHERE pos.is_current = 1 AND pos.committee IS NOT NULL AND mp.is_current = 1
      GROUP BY pos.committee, mp.person_id
      ORDER BY pos.committee, mp.last_name
    `).all() as Array<{ committee: string; id: number; name: string; slug: string | null; isCoalition: number | null }>;

    const membersByCommittee = new Map<string, Array<{ id: number; name: string; slug: string | null; isCoalition: boolean | null }>>();
    for (const r of memberRows) {
      if (!membersByCommittee.has(r.committee)) membersByCommittee.set(r.committee, []);
      membersByCommittee.get(r.committee)!.push({ id: r.id, name: r.name, slug: r.slug, isCoalition: r.isCoalition === null ? null : r.isCoalition === 1 });
    }

    // Top 5 passed bills per committee (most recent by id)
    const passedBillRows = db.prepare(`
      SELECT committee_name, id, title, init_date
      FROM (
        SELECT committee_name, id, title, init_date,
               ROW_NUMBER() OVER (PARTITION BY committee_name ORDER BY id DESC) as rn
        FROM bill
        WHERE is_passed = 1 AND committee_name IS NOT NULL
      ) WHERE rn <= 5
    `).all() as Array<{ committee_name: string; id: number; title: string; init_date: string | null }>;

    const billsByCommittee = new Map<string, Array<{ id: number; title: string; initDate: string | null }>>();
    for (const r of passedBillRows) {
      if (!billsByCommittee.has(r.committee_name)) billsByCommittee.set(r.committee_name, []);
      billsByCommittee.get(r.committee_name)!.push({ id: r.id, title: r.title, initDate: r.init_date ?? null });
    }

    const result = committees.map(c => ({
      ...c,
      memberCount: (membersByCommittee.get(c.name) ?? []).length || 0,
      members: membersByCommittee.get(c.name) ?? [],
      topPassedBills: billsByCommittee.get(c.name) ?? [],
    }));

    return NextResponse.json({ committees: result });
  } catch (error: any) {
    console.error('Committees DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
