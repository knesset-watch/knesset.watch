// scripts/generate-session-cards.ts
// Run: npm run db:generate-cards
//
// Generates a structured text "card" per session combining all enriched data:
// committee, date, attendees, guests (with org), staff, agenda, votes, bills.
// Stored in committee_session.rag_card — used as the RAG context unit.
// Resume-safe: skips sessions where rag_card IS NOT NULL.
// Pass --force to regenerate all cards.

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

function migrate(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(committee_session)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('rag_card')) {
    db.exec('ALTER TABLE committee_session ADD COLUMN rag_card TEXT');
    console.log('  Added rag_card to committee_session.');
  }
}

async function main() {
  const force = process.argv.includes('--force');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('Generate Session Cards');
  migrate(db);

  if (force) {
    db.exec('UPDATE committee_session SET rag_card = NULL');
    console.log('  --force: cleared all existing cards.');
  }

  const sessions = db.prepare(`
    SELECT cs.id, cs.date, cs.title, cs.committee_id, cs.protocol_number,
           cs.session_number, cs.start_time, cs.end_time,
           cs.status_desc, cs.type_desc, cs.no_protocol_reason,
           c.name as committee_name
    FROM committee_session cs
    LEFT JOIN committee c ON c.id = cs.committee_id
    WHERE cs.rag_card IS NULL
    ORDER BY cs.id ASC
  `).all() as any[];

  console.log(`  Sessions to process: ${sessions.length.toLocaleString()}`);
  if (sessions.length === 0) { db.close(); return; }

  // Pre-load lookups
  const getMks = db.prepare(`
    SELECT ca.role, m.first_name || ' ' || m.last_name as name, m.faction_name
    FROM committee_attendance ca
    JOIN mk_person m ON m.person_id = ca.mk_id
    WHERE ca.session_id = ?
    ORDER BY ca.role DESC, m.last_name ASC
  `);
  const getGuests = db.prepare(`
    SELECT name, organization, attendance_method
    FROM session_guest WHERE session_id = ?
    LIMIT 20
  `);
  const getStaff = db.prepare(`
    SELECT role, name_text FROM session_staff WHERE session_id = ? ORDER BY id
  `);
  const getAgenda = db.prepare(`
    SELECT item_number, title FROM session_agenda_item
    WHERE session_id = ? ORDER BY item_number ASC LIMIT 10
  `);
  const getVotes = db.prepare(`
    SELECT subject, for_count, against_count, abstain_count, passed
    FROM session_vote WHERE session_id = ? LIMIT 5
  `);
  const getBills = db.prepare(`
    SELECT b.title FROM session_bill sb
    JOIN bill b ON b.id = sb.bill_id
    WHERE sb.session_id = ? LIMIT 5
  `);

  const updateCard = db.prepare('UPDATE committee_session SET rag_card = ? WHERE id = ?');

  const ROLE_LABEL: Record<string, string> = {
    chair: 'יו"ר', deputy_chair: 'סגן יו"ר', minister: 'שר/ת', visitor: 'אורח',
  };
  const STAFF_LABEL: Record<string, string> = {
    legal_counsel: 'ייעוץ משפטי', manager: 'מנהל/ת הוועדה',
    writer: 'רישום פרלמנטרי', translator: 'תרגום',
  };

  let done = 0;
  const BATCH = 500;

  for (let i = 0; i < sessions.length; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);

    db.transaction(() => {
      for (const s of batch) {
        const lines: string[] = [];

        // ── Header line ──────────────────────────────────────────────────────
        const parts = [
          s.committee_name ?? `ועדה ${s.committee_id}`,
          s.date ? s.date.slice(0, 10) : '',
          s.protocol_number ? `פרוטוקול ${s.protocol_number}` : s.session_number ? `ישיבה ${s.session_number}` : '',
          s.start_time && s.end_time ? `${s.start_time}–${s.end_time}` : s.start_time ? `${s.start_time}` : '',
        ].filter(Boolean);
        lines.push(parts.join(' | '));

        if (s.title) lines.push(`נושא: ${s.title}`);
        if (s.status_desc === 'מבוטלת') lines.push('⚠ ישיבה בוטלה');
        if (s.type_desc?.includes('סגור') || s.type_desc?.includes('חסוי')) lines.push('🔒 ישיבה סגורה');

        // ── Attendees ────────────────────────────────────────────────────────
        const mks = getMks.all(s.id) as any[];
        if (mks.length > 0) {
          const mkParts = mks.map((m: any) => {
            const label = ROLE_LABEL[m.role];
            return label ? `${m.name} (${label})` : m.name;
          });
          // Show first 15, summarize rest
          if (mkParts.length <= 15) {
            lines.push(`נכחו: ${mkParts.join('; ')}`);
          } else {
            lines.push(`נכחו: ${mkParts.slice(0, 15).join('; ')} ועוד ${mkParts.length - 15}`);
          }
        }

        const guests = getGuests.all(s.id) as any[];
        if (guests.length > 0) {
          const gParts = guests.map((g: any) => {
            const tag = g.attendance_method === 'online' ? ' (מרחוק)' : '';
            const org = g.organization ? ` – ${g.organization}` : '';
            return `${g.name}${org}${tag}`;
          });
          lines.push(`מוזמנים: ${gParts.join('; ')}`);
        }

        const staff = getStaff.all(s.id) as any[];
        if (staff.length > 0) {
          const byRole = new Map<string, string[]>();
          for (const m of staff) {
            const label = STAFF_LABEL[m.role] ?? m.role;
            if (!byRole.has(label)) byRole.set(label, []);
            byRole.get(label)!.push(m.name_text);
          }
          const staffParts = [...byRole.entries()].map(([label, names]) => `${label}: ${names.join(', ')}`);
          lines.push(`צוות: ${staffParts.join('; ')}`);
        }

        // ── Agenda ───────────────────────────────────────────────────────────
        const agenda = getAgenda.all(s.id) as any[];
        if (agenda.length > 0) {
          const agParts = agenda.map((a: any) =>
            a.item_number ? `${a.item_number}. ${a.title}` : a.title
          );
          lines.push(`סדר היום: ${agParts.join('; ')}`);
        }

        // ── Votes ─────────────────────────────────────────────────────────────
        const votes = getVotes.all(s.id) as any[];
        if (votes.length > 0) {
          const vParts = votes.map((v: any) => {
            let out = v.subject ? v.subject.slice(0, 60) : '';
            const counts: string[] = [];
            if (v.for_count != null) counts.push(`${v.for_count} בעד`);
            if (v.against_count != null) counts.push(`${v.against_count} נגד`);
            if (v.abstain_count != null) counts.push(`${v.abstain_count} נמנע`);
            if (counts.length > 0) out += ` (${counts.join(', ')})`;
            const result = v.passed === 1 ? 'אושר' : v.passed === 0 ? 'נדחה' : '';
            if (result) out += ` — ${result}`;
            return out.trim();
          }).filter(Boolean);
          if (vParts.length > 0) lines.push(`הצבעות: ${vParts.join('; ')}`);
        }

        // ── Bills ─────────────────────────────────────────────────────────────
        const bills = getBills.all(s.id) as any[];
        if (bills.length > 0) {
          lines.push(`חקיקה: ${bills.map((b: any) => b.title).join('; ')}`);
        }

        // ── No-protocol note ──────────────────────────────────────────────────
        if (s.no_protocol_reason === 'cancelled') lines.push('אין פרוטוקול: ישיבה בוטלה');
        else if (s.no_protocol_reason === 'closed_session') lines.push('אין פרוטוקול: ישיבה סגורה');
        else if (s.no_protocol_reason === 'not_yet_published') lines.push('פרוטוקול טרם פורסם');

        const card = lines.filter(Boolean).join('\n');
        updateCard.run(card, s.id);
        done++;
      }
    })();

    if ((i + BATCH) % 2000 === 0 || i + BATCH >= sessions.length) {
      const pct = Math.round(((i + BATCH) / sessions.length) * 100);
      process.stdout.write(`\r    ${done}/${sessions.length} (${pct}%)`);
    }
  }

  console.log('\n');

  // Sample card
  const sample = db.prepare('SELECT rag_card FROM committee_session WHERE rag_card IS NOT NULL LIMIT 1').get() as any;
  if (sample) {
    console.log('Sample card:');
    console.log('─'.repeat(60));
    console.log(sample.rag_card);
    console.log('─'.repeat(60));
  }

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
