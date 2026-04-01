import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export const dynamic = 'force-dynamic';

export interface SearchHit {
  type: 'mk' | 'committee' | 'bill';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }
  if (q.length > 100) {
    return NextResponse.json({ error: 'שאילתה ארוכה מדי' }, { status: 400 });
  }

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const db = new Database(DB_PATH, { readonly: true });
  const term = `%${q}%`;
  const results: SearchHit[] = [];

  try {
    // MKs (mk_person table — name search)
    const mks = db.prepare(`
      SELECT person_id as id,
             first_name || ' ' || last_name as name,
             faction_name,
             slug
      FROM mk_person
      WHERE (first_name || ' ' || last_name) LIKE ?
      LIMIT 5
    `).all(term) as Array<{ id: number; name: string; faction_name: string | null; slug: string | null }>;

    for (const m of mks) {
      results.push({
        type: 'mk',
        id: String(m.id),
        title: m.name,
        subtitle: m.faction_name ?? null,
        url: `/mk/${m.slug ?? m.id}`,
      });
    }

    // Committees (committee_session table — distinct committee_name)
    const committees = db.prepare(`
      SELECT DISTINCT committee_name as name
      FROM committee_session
      WHERE committee_name LIKE ?
      LIMIT 5
    `).all(term) as Array<{ name: string }>;

    for (const c of committees) {
      results.push({
        type: 'committee',
        id: c.name,
        title: c.name,
        subtitle: 'ועדה',
        url: `/committee/${encodeURIComponent(c.name)}`,
      });
    }

    // Bills (bill table — title search)
    const bills = db.prepare(`
      SELECT id, title, status_desc, is_passed
      FROM bill
      WHERE title LIKE ?
      ORDER BY is_passed DESC, id DESC
      LIMIT 5
    `).all(term) as Array<{ id: number; title: string; status_desc: string | null; is_passed: number }>;

    for (const b of bills) {
      results.push({
        type: 'bill',
        id: String(b.id),
        title: b.title,
        subtitle: b.status_desc ?? (b.is_passed ? 'עבר' : 'בטיפול'),
        url: `/bill/${b.id}`,
      });
    }

    return NextResponse.json({ results });
  } finally {
    db.close();
  }
}
