/**
 * Cluster the 166 axis keywords into a smaller set of user-facing themes.
 *
 *   npx tsx scripts/cluster-axis-keywords.ts --dry-run
 *   npx tsx scripts/cluster-axis-keywords.ts
 *
 * למה: התגיות נגזרו כל אחת בנפרד, מהשאלה שלה בלבד. אף קריאה לא ראתה
 * את שאר התגיות, ולכן אותו רעיון נכתב בכמה נוסחים — תת-הנושא "אנשים
 * עם מוגבלות ונגישות" קיבל ארבע תגיות נפרדות (קצבאות נכות, אנשים עם
 * מוגבלות, ועדות רפואיות, הנגשה ותמיכה), וכל 166 יחד מכילות שש תגיות
 * שונות עם המילה "קצבאות".
 *
 * הקיבוץ נעשה בקריאה אחת לכל נושא-על, כשהמודל רואה את כל תגיות הנושא
 * בבת אחת — התנאי שבלעדיו הוא אינו יכול לדעת שהוא מכפיל.
 *
 * חשוב: התגיות המקוריות נשמרות בכל אשכול תחת members, כדי שאפשר יהיה
 * לבקר את האיחוד ולראות בדיוק מה אוחד לתוך מה.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'policy-analysis');
const KEYWORDS_PATH = path.join(DATA_DIR, 'axis-keywords.json');
const OUT_PATH = path.join(DATA_DIR, 'axis-clusters.json');

const MODEL = 'gemini-3.5-flash-lite';

/** כמה אשכולות לכל נושא-על. שבעה נכנסים למסך אחד בלי גלילה. */
const TARGET_CLUSTERS = 7;

interface AxisKeyword {
  issueId: string;
  topic: string;
  subtopic: string;
  keyword: string;
  question: string;
  billCount: number;
}

export interface ClusterMember {
  issueId: string;
  /** התגית כפי שהייתה לפני האיחוד — נשמרת לביקורת */
  originalKeyword: string;
  subtopic: string;
  question: string;
  billCount: number;
}

export interface AxisCluster {
  clusterId: string;
  topic: string;
  /** התגית המאוחדת, מה שהמשתמשת רואה ובוחרת */
  label: string;
  members: ClusterMember[];
  /** סכום הצעות החוק בכל הצירים שבאשכול */
  billCount: number;
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

function escapeHebrewQuotes(s: string): string {
  return s.replace(/([֐-׿])"([֐-׿])/g, '$1\\"$2');
}

const RULES = `אתה מקבץ תגיות של שאלות מדיניות לנושאים שמשתמש בוחר מהם.

אתה מקבל את כל התגיות של תחום אחד, ממוספרות. קבץ אותן לנושאים.

כללים:

- כוון ל-${TARGET_CLUSTERS} נושאים בערך. מותר פחות אם התחום קטן.
- כל תגית שייכת לנושא אחד בדיוק. אל תשמיט אף מספר ואל תכפיל.
- נושא הוא 1 עד 5 תגיות. תגית שאין לה שותפות נשארת לבדה — עדיף נושא
  של אחת מאשר לדחוף אותה למקום שאינו שלה.
- קבץ לפי מה שהאזרח היה מחשיב כאותו נושא, לא לפי מילה משותפת.
  "קצבאות נכות" ו"הנגשת שירותים" הן אותו נושא — נכות ונגישות.
  "קצבאות נכות" ו"קצבאות אזרחים ותיקים" אינן, למרות המילה המשותפת.
- label — שם הנושא ב-2 עד 3 מילים. שם שאזרח היה מחפש, לא כותרת
  מנהלית. בלי "האם", "מדיניות", "הסדרת", "רגולציה".
- אל תשתמש בשם התחום עצמו כשם נושא.

החזר JSON תקין בלבד:
{"clusters":[{"label":"<שם>","members":[<מספרים>]}]}

מרכאה כפולה עברית בתוך מילה שוברת JSON. השתמש בגרש ״ או השמט.`;

async function clusterTopic(
  topic: string,
  tags: AxisKeyword[],
  apiKey: string,
): Promise<Array<{ label: string; members: number[] }> | null> {
  const listed = tags
    .map((t, i) => `${i + 1}. ${t.keyword}   [${t.subtopic}]`)
    .join('\n');

  const prompt = [
    RULES,
    '',
    '────────',
    `תחום: ${topic}`,
    `מספר תגיות: ${tags.length}`,
    '',
    listed,
    '────────',
    '',
    'החזר JSON בלבד.',
  ].join('\n');

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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return null;

  const cleaned = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  let parsed: { clusters?: Array<{ label?: unknown; members?: unknown }> } | null = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      parsed = JSON.parse(escapeHebrewQuotes(cleaned));
    } catch {
      return null;
    }
  }

  const out: Array<{ label: string; members: number[] }> = [];
  for (const c of parsed?.clusters ?? []) {
    if (typeof c.label !== 'string' || !Array.isArray(c.members)) continue;
    const members = c.members
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= tags.length);
    if (members.length > 0) out.push({ label: c.label.trim(), members });
  }
  return out.length > 0 ? out : null;
}

function main2(clusters: AxisCluster[], dryRun: boolean, orphaned: number): void {
  const perTopic = new Map<string, number>();
  for (const c of clusters) perTopic.set(c.topic, (perTopic.get(c.topic) ?? 0) + 1);

  console.log('\n=== אשכולות לכל נושא-על ===');
  for (const [topic, n] of perTopic) console.log(`  ${String(n).padStart(2)}  ${topic}`);

  const sizes = clusters.map(c => c.members.length);
  console.log('');
  console.log(`  אשכולות סה"כ: ${clusters.length}  (מ-166 תגיות)`);
  console.log(`  תגיות באשכול: מינ' ${Math.min(...sizes)}  חציון ${sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)]}  מקס' ${Math.max(...sizes)}`);
  console.log(`  אשכולות של תגית בודדת: ${sizes.filter(s => s === 1).length}`);
  if (orphaned > 0) console.log(`  ⚠ תגיות שלא שובצו והושלמו לאשכול משלהן: ${orphaned}`);

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    return;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(clusters, null, 2), 'utf8');
  console.log(`\n  ${path.relative(process.cwd(), OUT_PATH)}`);
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing from .env.local');

  const dryRun = process.argv.slice(2).includes('--dry-run');
  const tags = JSON.parse(fs.readFileSync(KEYWORDS_PATH, 'utf8')) as AxisKeyword[];

  const byTopic = new Map<string, AxisKeyword[]>();
  for (const t of tags) {
    if (!byTopic.has(t.topic)) byTopic.set(t.topic, []);
    byTopic.get(t.topic)!.push(t);
  }

  console.log(`clustering ${tags.length} keywords across ${byTopic.size} topics\n`);

  const clusters: AxisCluster[] = [];
  let orphaned = 0;

  for (const [topic, topicTags] of byTopic) {
    let result: Array<{ label: string; members: number[] }> | null = null;
    try {
      result = await clusterTopic(topic, topicTags, apiKey);
    } catch (err) {
      console.log(`  ✗ ${topic}: ${(err as Error).message}`);
    }

    if (!result) {
      console.log(`  ✗ ${topic} — קיבוץ נכשל, התגיות נשארות כאשכולות בודדים`);
      topicTags.forEach((t, i) => {
        clusters.push({
          clusterId: `cl_${topic.slice(0, 3)}_${i}`,
          topic,
          label: t.keyword,
          members: [{ issueId: t.issueId, originalKeyword: t.keyword, subtopic: t.subtopic, question: t.question, billCount: t.billCount }],
          billCount: t.billCount,
        });
      });
      continue;
    }

    console.log(`\n▸ ${topic}  (${topicTags.length} תגיות → ${result.length} אשכולות)`);

    /** מי כבר שובץ, כדי לתפוס תגיות שהמודל השמיט */
    const assigned = new Set<number>();

    result.forEach((c, ci) => {
      const members: ClusterMember[] = [];
      for (const n of c.members) {
        if (assigned.has(n)) continue;
        assigned.add(n);
        const t = topicTags[n - 1];
        members.push({
          issueId: t.issueId,
          originalKeyword: t.keyword,
          subtopic: t.subtopic,
          question: t.question,
          billCount: t.billCount,
        });
      }
      if (members.length === 0) return;

      clusters.push({
        clusterId: `cl_${clusters.length.toString().padStart(3, '0')}`,
        topic,
        label: c.label,
        members,
        billCount: members.reduce((s, m) => s + m.billCount, 0),
      });

      console.log(`   ${(ci + 1).toString().padStart(2)}. ${c.label.padEnd(22)} ← ${members.map(m => m.originalKeyword).join(' · ')}`);
    });

    /**
     * תגית שהמודל השמיט אינה נעלמת. היא הופכת לאשכול משלה — עדיף נושא
     * של תגית אחת מאשר שאלה שנשמטה מהשאלון בלי שאיש ידע.
     */
    topicTags.forEach((t, i) => {
      if (assigned.has(i + 1)) return;
      orphaned++;
      clusters.push({
        clusterId: `cl_${clusters.length.toString().padStart(3, '0')}`,
        topic,
        label: t.keyword,
        members: [{ issueId: t.issueId, originalKeyword: t.keyword, subtopic: t.subtopic, question: t.question, billCount: t.billCount }],
        billCount: t.billCount,
      });
      console.log(`   ⚠  ${t.keyword} — לא שובץ, נשאר לבדו`);
    });
  }

  clusters.sort((a, b) => b.billCount - a.billCount);
  main2(clusters, dryRun, orphaned);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
