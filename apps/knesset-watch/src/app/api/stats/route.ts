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
  const idsParam = searchParams.get('personIds');
  const knessetNum = searchParams.get('knessetNum');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!idsParam) return NextResponse.json({ error: 'personIds required' }, { status: 400 });
  if (!dbAvailable()) return NextResponse.json({ error: 'Database not available' }, { status: 503 });

  const ids = idsParam.split(',').map(id => parseInt(id, 10));
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const results: Record<string, any> = {};
    ids.forEach(id => {
      results[id] = { 
        proposed: 0, 
        passed: 0,
        agendas: {} // macroAgenda -> { pushed: number, supported: number }
      };
    });

    const placeholder = ids.map(() => '?').join(',');
    const dateParams: string[] = [];
    const dateClause = startDate || endDate
      ? ` AND (${startDate ? 'pv.date >= ?' : '1'}) AND (${endDate ? 'pv.date <= ?' : '1'})`
      : '';
    if (startDate) dateParams.push(startDate);
    if (endDate) dateParams.push(endDate);

    const billDateParams: string[] = [];
    const billDateClause = startDate || endDate
      ? ` AND (${startDate ? 'b.publication_date >= ?' : '1'}) AND (${endDate ? 'b.publication_date <= ?' : '1'})`
      : '';
    if (startDate) billDateParams.push(startDate);
    if (endDate) billDateParams.push(endDate);

    // 1. Proposed bills and Pushed agendas
    const bills = db.prepare(`
      SELECT i.mk_id, b.is_passed, b.macro_agenda
      FROM bill_initiator i
      JOIN bill b ON b.id = i.bill_id
      WHERE i.mk_id IN (${placeholder})${billDateClause}
    `).all([...ids, ...billDateParams]) as Array<{ mk_id: number, is_passed: number, macro_agenda: string | null }>;

    bills.forEach(b => {
      const res = results[b.mk_id];
      if (!res) return;
      res.proposed++;
      if (b.is_passed) res.passed++;
      if (b.macro_agenda) {
        if (!res.agendas[b.macro_agenda]) res.agendas[b.macro_agenda] = { pushed: 0, supported: 0 };
        res.agendas[b.macro_agenda].pushed++;
      }
    });

    // 2. Supported agendas (Votes FOR)
    const votes = db.prepare(`
      SELECT r.mk_id, pv.macro_agenda, COUNT(*) as cnt
      FROM mk_vote_result r
      JOIN plenary_vote pv ON pv.id = r.vote_id
      WHERE r.mk_id IN (${placeholder}) AND r.result_code = 7 AND pv.macro_agenda IS NOT NULL${dateClause}
      GROUP BY r.mk_id, pv.macro_agenda
    `).all([...ids, ...dateParams]) as Array<{ mk_id: number, macro_agenda: string, cnt: number }>;

    votes.forEach(v => {
      const res = results[v.mk_id];
      if (!res) return;
      if (!res.agendas[v.macro_agenda]) res.agendas[v.macro_agenda] = { pushed: 0, supported: 0 };
      res.agendas[v.macro_agenda].supported = v.cnt;
    });

    // 3. Rebellion counts
    const rebellions = db.prepare(`
      SELECT r.mk_id, COUNT(*) as cnt
      FROM mk_vote_result r
      JOIN mk_person p ON p.person_id = r.mk_id
      JOIN plenary_vote pv ON pv.id = r.vote_id
      JOIN vote_faction_stats s ON s.vote_id = r.vote_id AND s.faction_id = p.faction_id
      WHERE r.mk_id IN (${placeholder}) AND r.result_code IN (7, 8) AND r.result_code != s.majority_code${dateClause}
      GROUP BY r.mk_id
    `).all([...ids, ...dateParams]) as Array<{ mk_id: number, cnt: number }>;

    rebellions.forEach(r => {
      if (results[r.mk_id]) results[r.mk_id].rebellions = r.cnt;
    });

    // 4. Committee session attendance (join to session date for filtering)
    const attendanceDateParams: string[] = [];
    const attendanceDateClause = startDate || endDate
      ? ` JOIN committee_session cs ON cs.id = ca.session_id WHERE ca.mk_id IN (${placeholder})${startDate ? ' AND cs.date >= ?' : ''}${endDate ? ' AND cs.date <= ?' : ''}`
      : ` WHERE mk_id IN (${placeholder})`;
    if (startDate) attendanceDateParams.push(startDate);
    if (endDate) attendanceDateParams.push(endDate);

    const attendanceSql = (startDate || endDate)
      ? `SELECT ca.mk_id, COUNT(*) as cnt FROM committee_attendance ca${attendanceDateClause} GROUP BY ca.mk_id`
      : `SELECT mk_id, COUNT(*) as cnt FROM committee_attendance WHERE mk_id IN (${placeholder}) GROUP BY mk_id`;

    const attendance = db.prepare(attendanceSql)
      .all([...ids, ...attendanceDateParams]) as Array<{ mk_id: number, cnt: number }>;

    attendance.forEach(a => {
      if (results[a.mk_id]) results[a.mk_id].committeeSessions = a.cnt;
    });

    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Stats DB fetch error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
