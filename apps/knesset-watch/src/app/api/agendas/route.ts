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
    /**
     * ספירת הצעות החוק לכל אג'נדה.
     *
     * bill.macro_agenda ריק בכל 7,296 השורות, ולכן השאילתה הקודמת
     * (WHERE macro_agenda IS NOT NULL על bill) החזירה תמיד אפס שורות —
     * וכל אחד עשר הכרטיסים בעמוד הציגו "0 הצעות חוק" לצד מאות הצבעות.
     *
     * במקום זה החוק יורש את האג'נדה מההצבעה שנערכה עליו. מכסה 946
     * חוקים שהגיעו להצבעת מליאה — לא את כולם, אבל נכון ולא אפס.
     *
     * plenary_vote.bill_id לא קיים ב-knesset-deploy.db, שהוא מה שנפרס
     * בפרודקשן. בלעדיו נשארת ההתנהגות הישנה במקום קריסה.
     */
    const hasVoteBillId = (db
      .prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('plenary_vote') WHERE name = 'bill_id'`)
      .get() as { n: number }).n > 0;

    const bills = hasVoteBillId
      ? (db.prepare(`
          SELECT macro_agenda as id, COUNT(DISTINCT bill_id) as billCount
          FROM plenary_vote
          WHERE bill_id IS NOT NULL AND macro_agenda IS NOT NULL
          GROUP BY macro_agenda
        `).all() as any[])
      : [];

    const votes = db.prepare(`
      SELECT macro_agenda as id, COUNT(*) as voteCount
      FROM plenary_vote
      WHERE macro_agenda IS NOT NULL
      GROUP BY macro_agenda
    `).all() as any[];

    const agendaMap = new Map<string, any>();

    for (const b of bills) {
      agendaMap.set(b.id, { id: b.id, label: b.id, billCount: b.billCount, voteCount: 0 });
    }

    for (const v of votes) {
      if (!agendaMap.has(v.id)) {
        agendaMap.set(v.id, { id: v.id, label: v.id, billCount: 0, voteCount: v.voteCount });
      } else {
        agendaMap.get(v.id).voteCount = v.voteCount;
      }
    }

    const agendas = Array.from(agendaMap.values()).sort((a, b) => (b.billCount + b.voteCount) - (a.billCount + a.voteCount));

    return NextResponse.json({ agendas });
  } catch (error: any) {
    console.error('Agendas DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
