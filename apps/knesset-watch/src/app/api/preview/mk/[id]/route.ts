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
  const mkId = parseInt(id, 10);
  if (isNaN(mkId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const person = db.prepare(`
      SELECT person_id, first_name || ' ' || last_name as name,
             faction_name, is_coalition
      FROM mk_person WHERE person_id = ? OR slug = ?
      LIMIT 1
    `).get(mkId, id) as { person_id: number; name: string; faction_name: string | null; is_coalition: number | null } | undefined;

    if (!person) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const billStats = db.prepare(`
      SELECT COUNT(*) as proposed,
             SUM(CASE WHEN b.is_passed = 1 THEN 1 ELSE 0 END) as passed
      FROM bill_initiator bi JOIN bill b ON b.id = bi.bill_id
      WHERE bi.mk_id = ?
    `).get(person.person_id) as { proposed: number; passed: number };

    const committeeSessions = (db.prepare(`
      SELECT COUNT(*) as cnt FROM committee_attendance WHERE mk_id = ?
    `).get(person.person_id) as { cnt: number }).cnt;

    const ministerRole = (db.prepare(`
      SELECT duty_desc FROM mk_position
      WHERE mk_id = ? AND is_current = 1
        AND (duty_desc LIKE 'שר %' OR duty_desc LIKE 'שרת %'
          OR duty_desc LIKE 'השר %' OR duty_desc LIKE 'השרה %'
          OR duty_desc LIKE 'סגן שר%' OR duty_desc LIKE 'סגנית שר%')
      LIMIT 1
    `).get(person.person_id) as { duty_desc: string } | undefined)?.duty_desc ?? null;

    return NextResponse.json({
      id: person.person_id,
      name: person.name,
      factionName: person.faction_name,
      isCoalition: person.is_coalition === null ? null : person.is_coalition === 1,
      ministerRole,
      proposed: billStats?.proposed ?? 0,
      passed: billStats?.passed ?? 0,
      committeeSessions,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    db?.close();
  }
}
