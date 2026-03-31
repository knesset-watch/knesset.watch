// scripts/fix-attendance.ts
// Run: npm run db:fix-attendance
//
// Fixes a bug in parse-protocols.ts where attendanceEnd was computed from the
// start of the document (finding << נושא >> markers in the header agenda section)
// instead of from nkhuIdx. This caused empty attendance blocks for most sessions.
//
// Re-parses attendance for all sessions. Clears and repopulates:
//   - committee_attendance (MK rows)
//   - session_guest (external guest rows)

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

function buildMkMap(db: Database.Database): Map<string, number> {
  const mks = db.prepare('SELECT person_id, first_name, last_name FROM mk_person').all() as any[];
  const map = new Map<string, number>();
  const lastNameCount = new Map<string, number>();

  for (const mk of mks) {
    const full = `${mk.first_name} ${mk.last_name}`.trim();
    map.set(full, mk.person_id);
    lastNameCount.set(mk.last_name, (lastNameCount.get(mk.last_name) ?? 0) + 1);
  }
  for (const mk of mks) {
    if ((lastNameCount.get(mk.last_name) ?? 0) === 1 && !map.has(mk.last_name)) {
      map.set(mk.last_name, mk.person_id);
    }
  }
  return map;
}

function stripTitle(name: string): string {
  return name
    .replace(/^(היו"ר|יו"ר|ח"כ|ד"ר|פרופ'?|עו"ד|השר|שר|השרה|שרת|ממלא|הממלא|מ"מ|סגן|הסגן)\s+/g, '')
    .trim();
}

function resolveMk(raw: string, mkMap: Map<string, number>): number | null {
  const name = stripTitle(raw).replace(/\s*\([^)]*\)/g, '').trim();
  if (mkMap.has(name)) return mkMap.get(name)!;
  const parts = name.split(/\s+/);
  if (parts.length > 1) {
    const lastName = parts[parts.length - 1];
    if (mkMap.has(lastName)) return mkMap.get(lastName)!;
  }
  return null;
}

interface AttendanceMember {
  name: string;
  role: string;
  mk_id: number | null;
}

interface AttendanceGuest {
  name: string;
  role: string;
  org: string;
  method: string;
}

function parseAttendanceBlock(text: string, nkhuIdx: number, mkMap: Map<string, number>): {
  members: AttendanceMember[];
  guests: AttendanceGuest[];
} {
  // FIXED: find attendanceEnd starting from nkhuIdx, not from 0
  let attendanceEnd = text.indexOf('<<', nkhuIdx + 5);
  if (attendanceEnd < 0) attendanceEnd = text.length;

  // Also cut at staff section headers
  for (const h of ['ייעוץ משפטי:', 'מנהלת הוועדה:', 'מנהל הוועדה:', 'רישום פרלמנטרי:']) {
    const idx = text.indexOf(h, nkhuIdx);
    if (idx > nkhuIdx && idx < attendanceEnd) attendanceEnd = idx;
  }

  const block = text.slice(nkhuIdx, attendanceEnd);
  const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const members: AttendanceMember[] = [];
  const guests: AttendanceGuest[] = [];
  let section: 'members' | 'visiting' | 'guests' | 'online' | 'unknown' = 'unknown';

  for (const line of lines) {
    if (line === 'נכחו:' || line === 'נכחו') continue;
    if (/^חברי הוועדה/.test(line)) { section = 'members'; continue; }
    if (/^חברי הכנסת/.test(line)) { section = 'visiting'; continue; }
    if (/^מוזמנים/.test(line)) { section = 'guests'; continue; }
    if (/באמצעים מקוונים|באמצעות האינטרנט|מרחוק/.test(line)) { section = 'online'; continue; }

    if (line.length < 2 || line.length > 120) continue;

    if (section === 'members') {
      const dash = line.indexOf('–');
      const name = (dash >= 0 ? line.slice(0, dash) : line).trim();
      const roleText = dash >= 0 ? line.slice(dash + 1).trim() : '';
      const role = /יו"ר|יושב.ראש/.test(roleText) ? 'chair'
        : /מ"מ|סגן|ממלא/.test(roleText) ? 'deputy_chair'
        : 'member';
      const mk_id = resolveMk(name, mkMap);
      if (name) members.push({ name, role, mk_id });

    } else if (section === 'visiting') {
      const name = line.replace(/\s*\([^)]*\)/g, '').trim();
      const mk_id = resolveMk(name, mkMap);
      if (name) members.push({ name, role: 'visitor', mk_id });

    } else if (section === 'guests' || section === 'online') {
      const method = section === 'online' ? 'online' : 'in_person';
      const isMinister = /^(שר|שרת|השר|השרה)\s/.test(line);

      if (isMinister) {
        const name = stripTitle(line).split(/[–,]/)[0].trim();
        const mk_id = resolveMk(name, mkMap);
        members.push({ name, role: 'minister', mk_id });
      } else {
        const dash = line.indexOf('–');
        const name = (dash >= 0 ? line.slice(0, dash) : line).trim();
        const roleOrg = dash >= 0 ? line.slice(dash + 1).trim() : '';
        const comma = roleOrg.indexOf(',');
        const role = (comma >= 0 ? roleOrg.slice(0, comma) : roleOrg).trim();
        const org = (comma >= 0 ? roleOrg.slice(comma + 1) : '').trim();
        if (name) guests.push({ name, role, org, method });
      }
    }
  }

  return { members, guests };
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('Fix Attendance Parsing');

  const mkMap = buildMkMap(db);
  const mkCount = (db.prepare('SELECT COUNT(*) as c FROM mk_person').get() as any).c;
  console.log(`  MK lookup: ${mkMap.size} entries for ${mkCount} MKs`);

  // Clear existing (was populated with empty blocks)
  const deletedAtt = db.prepare('DELETE FROM committee_attendance').run();
  const deletedGuest = db.prepare('DELETE FROM session_guest').run();
  console.log(`  Cleared ${deletedAtt.changes.toLocaleString()} attendance + ${deletedGuest.changes.toLocaleString()} guest rows.`);

  const sessions = db.prepare(`
    SELECT id, protocol_text FROM committee_session
    WHERE protocol_text IS NOT NULL AND length(protocol_text) > 10
    ORDER BY id ASC
  `).all() as { id: number; protocol_text: string }[];

  console.log(`  Sessions to process: ${sessions.length.toLocaleString()}`);

  const insertAttendance = db.prepare(
    'INSERT OR IGNORE INTO committee_attendance (session_id, mk_id, role) VALUES (?, ?, ?)'
  );
  const insertGuest = db.prepare(`
    INSERT INTO session_guest (session_id, name, role, organization, attendance_method)
    VALUES (?, ?, ?, ?, ?)
  `);

  let totalMks = 0;
  let totalGuests = 0;
  let sessionsWithAtt = 0;
  let unresolvedMks = 0;

  const BATCH = 500;

  for (let i = 0; i < sessions.length; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);

    db.transaction(() => {
      for (const s of batch) {
        const nkhuIdx = s.protocol_text.indexOf('נכחו:');
        if (nkhuIdx < 0) continue;

        const { members, guests } = parseAttendanceBlock(s.protocol_text, nkhuIdx, mkMap);

        let hadAtt = false;
        for (const m of members) {
          if (m.mk_id) {
            insertAttendance.run(s.id, m.mk_id, m.role);
            totalMks++;
            hadAtt = true;
          } else if (m.role === 'visitor') {
            insertGuest.run(s.id, m.name, 'unresolved_mk', '', 'in_person');
            unresolvedMks++;
          }
        }
        for (const g of guests) {
          insertGuest.run(s.id, g.name, g.role || null, g.org || '', g.method);
          totalGuests++;
        }
        if (hadAtt) sessionsWithAtt++;
      }
    })();

    if ((i + BATCH) % 2000 === 0 || i + BATCH >= sessions.length) {
      const pct = Math.round(((i + BATCH) / sessions.length) * 100);
      process.stdout.write(`\r    ${i + BATCH}/${sessions.length} (${pct}%) — ${totalMks.toLocaleString()} MK rows, ${totalGuests.toLocaleString()} guests`);
    }
  }

  console.log('\n');

  const finalAtt = (db.prepare('SELECT COUNT(*) as c FROM committee_attendance').get() as any).c;
  const finalGuest = (db.prepare('SELECT COUNT(*) as c FROM session_guest').get() as any).c;

  console.log('Results:');
  console.log(`  committee_attendance : ${finalAtt.toLocaleString()} rows (${sessionsWithAtt.toLocaleString()} sessions)`);
  console.log(`  session_guest        : ${finalGuest.toLocaleString()} rows`);
  console.log(`  unresolved MK names  : ${unresolvedMks.toLocaleString()} (in session_guest as unresolved_mk)`);

  // Top unresolved names for diagnosis
  const topUnresolved = db.prepare(`
    SELECT name, COUNT(*) as cnt FROM session_guest
    WHERE role = 'unresolved_mk' GROUP BY name ORDER BY cnt DESC LIMIT 10
  `).all() as any[];
  if (topUnresolved.length > 0) {
    console.log('\n  Top unresolved MK names (may need name variant mapping):');
    topUnresolved.forEach(r => console.log(`    ${r.cnt}x ${r.name}`));
  }

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
