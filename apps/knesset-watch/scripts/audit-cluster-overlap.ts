/**
 * פס א · איתור צירים חופפים בתוך אשכול.
 *
 *   npx tsx scripts/audit-cluster-overlap.ts --validate   שלושה אשכולות מוכרים
 *   npx tsx scripts/audit-cluster-overlap.ts              כל 53
 *   npx tsx scripts/audit-cluster-overlap.ts --json out.json
 *
 * הרקע: כל ציר נוסח בנפרד, והמודל שכתב את העמדות של ציר אחד מעולם לא
 * ראה את הציר שלידו. לכן הוא לא היה יכול לדעת ששני צירים באותו אשכול
 * שואלים אותו דבר, או את ההפך זה מזה. אלה פגמים יחסיים — בלתי נראים
 * מתוך ציר בודד, ונראים מיד כשנותנים את האשכול כולו בבת אחת.
 *
 * זה חשוב כי כל חברי האשכול מוצגים למשתמשת במסך אחד. כפילות נראית לה
 * כמו אותה שאלה פעמיים, וזוג הפוך גורם לה לענות על אותו דבר בשני
 * כיוונים — והמנוע סופר את שניהם.
 *
 * ── על האימות ──────────────────────────────────────────────────────
 *
 * --validate מריץ רק על שלושה אשכולות שבהם כבר מצאנו ביד מה שצריך
 * לצאת, ובודק שהם נמצאים. זה לא נוהל טקסי: בסבב הקודם בניתי מבחן
 * סטטיסטי שנראה סביר, ורק אימות מול מקרים ידועים גילה שהוא מחזיר
 * רעש. מבחן שלא מוצא את מה שאנחנו כבר יודעות אינו ראוי לאמון במה
 * שהוא כן מדווח.
 *
 * שלושת המקרים נמצאו בקריאה ידנית של axis-clusters.json ושל ההצעות
 * המסווגות לכל ציר, ולא על ידי מודל.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const MODEL = 'gemini-3.5-flash-lite';
const DATA_DIR = path.join(process.cwd(), 'data', 'policy-analysis');
const DB_PATH = path.join(process.cwd(), 'knesset.db');

/** מה שכבר מצאנו ביד. המפתח הוא שם האשכול. */
const KNOWN: Record<string, Array<{ pair: [string, string]; kind: Kind }>> = {
  'פשיעה, אכיפה וענישה': [
    { pair: ['ax_c6c000cb74', 'ax_fdc1475368'], kind: 'duplicate' },
  ],
  'תרבות ומורשת': [
    { pair: ['ax_0a2ba5871e', 'ax_4a0f6a172d'], kind: 'duplicate' },
  ],
  'מערכת הבריאות והרפואה': [
    { pair: ['ax_a1e872c1ff', 'ax_597feede1e'], kind: 'inverse' },
  ],
};

type Kind = 'duplicate' | 'inverse';

interface Member {
  issueId: string;
  question: string;
  pro: string;
  con: string;
  billCount: number;
}

interface Cluster {
  clusterId: string;
  label: string;
  topic: string;
  members: Member[];
}

interface FoundPair {
  a: string;
  b: string;
  kind: Kind;
  confidence: number;
  reason: string;
}

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function loadClusters(): Cluster[] {
  const clusters = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'axis-clusters.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'axis-catalog.json'), 'utf8'));
  const byId = new Map<string, any>(catalog.map((a: any) => [a.issueId, a]));

  const db = new Database(DB_PATH, { readonly: true });
  const cnt = db.prepare('SELECT COUNT(*) n FROM bill_political_classification WHERE issue_id=?');

  return clusters.map((c: any) => ({
    clusterId: c.clusterId,
    label: c.label,
    topic: c.topic,
    members: c.members.map((m: any) => {
      const a = byId.get(m.issueId);
      return {
        issueId: m.issueId,
        question: m.question,
        pro: a?.stances?.[0]?.label ?? '',
        con: a?.stances?.[1]?.label ?? '',
        billCount: (cnt.get(m.issueId) as { n: number }).n,
      };
    }),
  }));
}

function buildPrompt(c: Cluster): string {
  const rendered = c.members
    .map(
      (m, i) =>
        [
          `${i + 1}. מזהה: ${m.issueId}   (${m.billCount} הצעות חוק)`,
          `   שאלה: ${m.question}`,
          `   בעד : ${m.pro}`,
          `   נגד : ${m.con}`,
        ].join('\n'),
    )
    .join('\n\n');

  return [
    'לפניך קבוצת צירי מדיניות מתוך שאלון פוליטי. כל הצירים בקבוצה מוצגים',
    'למשתמשת במסך אחד, זה מתחת לזה.',
    '',
    'המשימה: לאתר זוגות של צירים שאסור שיופיעו יחד באותו מסך.',
    '',
    'שני סוגים:',
    '',
    'duplicate — שני צירים ששואלים למעשה את אותה שאלה. המשתמשת תענה',
    '  על אותו דבר פעמיים ותחשוב שהיא טועה או שהשאלון חוזר על עצמו.',
    '',
    'inverse — שני צירים שהם הכיוון ההפוך זה של זה. מי שמסכימה עם אחד',
    '  חייבת לא להסכים עם השני. סימן מובהק: עמדת ה"בעד" של אחד דומה',
    '  לעמדת ה"נגד" של השני.',
    '',
    'שים לב במיוחד לציר רחב וציר צר שנבלע בתוכו — למשל "האם להחמיר',
    'ענישה" לצד "האם להחמיר ענישה ולקבוע עונשי מינימום". מי שעונה על',
    'הרחב כבר ענה למעשה על הצר, וזה נחשב duplicate.',
    '',
    'מה שאינו נחשב:',
    '- שני צירים באותו תחום אבל על שאלות מדיניות שונות שאפשר להחזיק',
    '  בעמדות בלתי תלויות לגביהן',
    '- שני צירים שמשתמשים באותן מילים אבל שואלים דברים שונים',
    '',
    'היה שמרן. עדיף לא לדווח על זוג גבולי מאשר לדווח על זוג תקין.',
    '',
    '────────',
    `אשכול: ${c.label}`,
    `נושא-על: ${c.topic}`,
    '',
    rendered,
    '────────',
    '',
    'החזר JSON במבנה הזה בלבד:',
    '{"pairs":[{"a":"<מזהה>","b":"<מזהה>","kind":"duplicate|inverse",',
    '"confidence":<0-1>,"reason":"<משפט אחד בעברית>"}]}',
    '',
    'אם אין זוגות כאלה, החזר {"pairs":[]}.',
  ].join('\n');
}

async function askGemini(prompt: string, apiKey: string): Promise<FoundPair[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.pairs) ? parsed.pairs : [];
}

const samePair = (p: FoundPair, want: [string, string]) =>
  (p.a === want[0] && p.b === want[1]) || (p.a === want[1] && p.b === want[0]);

async function main() {
  loadEnvLocal();
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing from .env.local');

  const validate = process.argv.includes('--validate');
  const jsonArg = process.argv.find(a => a.startsWith('--json'));

  const all = loadClusters();
  const clusters = validate ? all.filter(c => KNOWN[c.label]) : all;

  if (validate && clusters.length !== Object.keys(KNOWN).length) {
    throw new Error(`אשכולות האימות לא נמצאו: ציפיתי ל-${Object.keys(KNOWN).length}, מצאתי ${clusters.length}`);
  }

  console.log(`${validate ? 'אימות' : 'הרצה מלאה'} · ${clusters.length} אשכולות · ${MODEL}\n`);

  const results: Array<{ cluster: string; pairs: FoundPair[] }> = [];
  let hits = 0;
  let expected = 0;

  for (const c of clusters) {
    process.stdout.write(`${c.label.padEnd(30)} `);
    let pairs: FoundPair[] = [];
    try {
      pairs = await askGemini(buildPrompt(c), apiKey);
    } catch (e) {
      console.log(`שגיאה: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    results.push({ cluster: c.label, pairs });

    if (validate) {
      const want = KNOWN[c.label];
      expected += want.length;
      const found = want.filter(w => pairs.some(p => samePair(p, w.pair)));
      hits += found.length;
      const kindOk = want.every(w => {
        const p = pairs.find(x => samePair(x, w.pair));
        return p ? p.kind === w.kind : false;
      });
      console.log(
        `${found.length}/${want.length} מהידועים` +
          (found.length === want.length ? (kindOk ? ' ✓' : ' ✓ (סוג שגוי)') : ' ✗') +
          ` · ${pairs.length} דווחו בסך הכול`,
      );
      for (const p of pairs) {
        const known = want.some(w => samePair(p, w.pair));
        console.log(`    ${known ? '·' : '+'} ${p.a} ↔ ${p.b}  [${p.kind} ${p.confidence}]  ${p.reason}`);
      }
    } else {
      console.log(`${pairs.length} זוגות`);
      for (const p of pairs) console.log(`    · ${p.a} ↔ ${p.b}  [${p.kind} ${p.confidence}]  ${p.reason}`);
    }
  }

  if (validate) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`נמצאו ${hits} מתוך ${expected} המקרים הידועים.`);
    console.log(
      hits === expected
        ? 'האימות עבר. אפשר להריץ על כל 53 האשכולות.'
        : 'האימות נכשל. אין סיבה להאמין לדיווחים על אשכולות שלא בדקנו ביד.',
    );
  }

  if (jsonArg) {
    const out = jsonArg.includes('=') ? jsonArg.split('=')[1] : 'cluster-overlap.json';
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    console.log(`\nנכתב: ${out}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
