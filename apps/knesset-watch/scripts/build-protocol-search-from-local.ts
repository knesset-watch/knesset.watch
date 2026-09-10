import Database from 'better-sqlite3';
import path from 'path';

const KNESSET_DB = path.join(process.cwd(), 'knesset.db');
const PROTOCOLS_DB = path.join(process.cwd(), 'protocols.db');

const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 300;

const SPEAKER_RE =
  /^(היו"ר|ח"כ|מר|גב'|ד"ר|פרופ'|שר|סגן שר)\s+([^\n:：]{2,40})[:：]/mu;
const SPEAKER_LINE_RE = /^([^\n:：]{2,40})[:：]\s*$/mu;

function extractSpeaker(line: string): string | null {
  const m = line.match(SPEAKER_RE);
  if (m) return `${m[1]} ${m[2]}`.trim();

  const m2 = line.match(SPEAKER_LINE_RE);
  if (m2) return m2[1].trim();

  return null;
}

function chunkText(
  text: string,
): Array<{ text: string; speaker: string | null }> {
  const lines = text.split('\n');
  const turns: Array<{ speaker: string | null; text: string }> = [];

  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const speaker = extractSpeaker(line);

    if (speaker && currentLines.join('\n').length > 50) {
      const t = currentLines.join('\n').trim();

      if (t.length > 20) {
        turns.push({
          speaker: currentSpeaker,
          text: t,
        });
      }

      currentSpeaker = speaker;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length) {
    const t = currentLines.join('\n').trim();

    if (t.length > 20) {
      turns.push({
        speaker: currentSpeaker,
        text: t,
      });
    }
  }

  const chunks: Array<{ text: string; speaker: string | null }> = [];

  for (const turn of turns) {
    if (turn.text.length <= CHUNK_SIZE) {
      chunks.push(turn);
      continue;
    }

    let i = 0;

    while (i < turn.text.length) {
      chunks.push({
        text: turn.text.slice(i, i + CHUNK_SIZE),
        speaker: turn.speaker,
      });

      i += CHUNK_SIZE - CHUNK_OVERLAP;
    }
  }

  return chunks;
}

function main() {
  const knessetDb = new Database(KNESSET_DB, { readonly: true });
  const db = new Database(PROTOCOLS_DB);

  const alreadyDone = new Set(
    (
      db
        .prepare('SELECT session_id FROM session_protocol')
        .all() as Array<{ session_id: number }>
    ).map((r) => r.session_id),
  );

  const sessions = knessetDb
    .prepare(`
      SELECT
        id,
        committee_id,
        committee_name,
        date,
        title,
        protocol_url,
        protocol_text
      FROM committee_session
      WHERE protocol_text IS NOT NULL
        AND LENGTH(protocol_text) > 10
      ORDER BY id
    `)
    .all() as Array<{
      id: number;
      committee_id: number | null;
      committee_name: string | null;
      date: string;
      title: string | null;
      protocol_url: string | null;
      protocol_text: string;
    }>;

  const pending = sessions.filter((s) => !alreadyDone.has(s.id));

  console.log(`Protocol texts available: ${sessions.length.toLocaleString()}`);
  console.log(`Already indexed:          ${alreadyDone.size.toLocaleString()}`);
  console.log(`Sessions to index:        ${pending.length.toLocaleString()}`);

  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO session_protocol
      (
        session_id,
        committee_id,
        committee_name,
        date,
        title,
        doc_url,
        chunk_count
      )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertChunk = db.prepare(`
    INSERT INTO protocol_chunk
      (session_id, chunk_index, text, speaker)
    VALUES (?, ?, ?, ?)
  `);

  const insertFts = db.prepare(`
    INSERT INTO protocol_chunk_fts
      (text, chunk_id, session_id, committee_name, date, speaker)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let indexed = 0;
  let chunkCount = 0;
  let skipped = 0;

  const writeSession = db.transaction((s: typeof pending[number]) => {
    const chunks = chunkText(s.protocol_text.trim());

    if (!chunks.length) {
      skipped++;
      return;
    }

    insertSession.run(
      s.id,
      s.committee_id ?? -1,
      s.committee_name,
      s.date,
      s.title,
      s.protocol_url,
      chunks.length,
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const r = insertChunk.run(
        s.id,
        i,
        chunk.text,
        chunk.speaker,
      );

      insertFts.run(
        chunk.text,
        r.lastInsertRowid,
        s.id,
        s.committee_name ?? '',
        s.date,
        chunk.speaker ?? '',
      );
    }

    indexed++;
    chunkCount += chunks.length;
  });

  for (let i = 0; i < pending.length; i++) {
    writeSession(pending[i]);

    if ((i + 1) % 500 === 0 || i + 1 === pending.length) {
      console.log(
        `${(i + 1).toLocaleString()} / ${pending.length.toLocaleString()} sessions`,
      );
    }
  }

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM session_protocol) AS sessions,
      (SELECT COUNT(*) FROM protocol_chunk) AS chunks,
      (SELECT COUNT(*) FROM protocol_chunk_fts) AS fts_rows,
      (SELECT MAX(date) FROM session_protocol) AS latest
  `).get();

  console.log('\nDone.');
  console.log(`Indexed this run: ${indexed.toLocaleString()}`);
  console.log(`Chunks this run:  ${chunkCount.toLocaleString()}`);
  console.log(`Skipped:          ${skipped.toLocaleString()}`);
  console.log('Final stats:', stats);

  knessetDb.close();
  db.close();
}

main();
