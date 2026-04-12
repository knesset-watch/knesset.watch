import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { name } = await params;
  const factionName = decodeURIComponent(name).trim();

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const base = db.prepare(`
      SELECT MAX(is_coalition) as is_coalition,
             COUNT(*) as member_count,
             MIN(faction_id) as faction_id
      FROM mk_person WHERE TRIM(faction_name) = ? AND is_current = 1
    `).get(factionName) as { is_coalition: number | null; member_count: number; faction_id: number | null } | undefined;

    if (!base || base.member_count === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const billStats = db.prepare(`
      SELECT COUNT(*) as proposed,
             SUM(CASE WHEN b.is_passed = 1 THEN 1 ELSE 0 END) as passed
      FROM bill b
      JOIN bill_initiator bi ON bi.bill_id = b.id
      JOIN mk_person p ON p.person_id = bi.mk_id
      WHERE TRIM(p.faction_name) = ?
    `).get(factionName) as { proposed: number; passed: number };

    let rebelRate: number | null = null;
    if (base.faction_id) {
      const rebel = db.prepare(`
        SELECT AVG(CAST(rebel_count AS REAL) / NULLIF(total_for + total_against, 0)) * 100 as rate
        FROM vote_faction_stats WHERE faction_id = ?
      `).get(base.faction_id) as { rate: number | null } | undefined;
      rebelRate = rebel?.rate != null ? Math.round(rebel.rate) : null;
    }

    return NextResponse.json({
      name: factionName,
      isCoalition: base.is_coalition === null ? null : base.is_coalition === 1,
      memberCount: base.member_count,
      proposed: billStats?.proposed ?? 0,
      passed: billStats?.passed ?? 0,
      rebelRate,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    db?.close();
  }
}
