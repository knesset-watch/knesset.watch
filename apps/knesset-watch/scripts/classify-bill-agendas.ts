// scripts/classify-bill-agendas.ts
//
// Run:
//   npx tsx scripts/classify-bill-agendas.ts
//
// Classifies bills into agendas based on:
//   title
//   summary
//   committee_name
//   text_content
//
// Saves results into bill_agenda.

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "knesset.db");

// ─────────────────────────────────────────────────────────────────────────────
// Agenda taxonomy
// ─────────────────────────────────────────────────────────────────────────────

const AGENDAS = [
  {
    id: "security",
    label: "ביטחון וצבא",
    keywords: [
      "ביטחון",
      'צה"ל',
      "צבא",
      "חייל",
      "חיילים",
      "מילואים",
      "מילואימניק",
      "טרור",
      "מחבל",
      "נשק",
      "מלחמה",
      "מערכת הביטחון",
      "שירות ביטחון",
      "שירות צבאי",
      "גיוס",
      "פיקוד העורף",
    ],
  },

  {
    id: "economy",
    label: "כלכלה ויוקר המחיה",
    keywords: [
      "כלכלה",
      "יוקר המחיה",
      "מחירים",
      "מחיר",
      "צרכן",
      "צרכנים",
      "תקציב",
      "מיסוי",
      "מסים",
      "מס ",
      "מע״מ",
      'מע"מ',
      "בנק",
      "בנקים",
      "אשראי",
      "הלוואה",
      "מכס",
      "יבוא",
      "יצוא",
      "עסקים",
      "עסק קטן",
      "תחרות",
      "ריבית",
    ],
  },

  {
    id: "health",
    label: "בריאות ורווחה",
    keywords: [
      "בריאות",
      "רפואה",
      "רפואי",
      "חולה",
      "חולים",
      "בית חולים",
      "בתי חולים",
      "קופת חולים",
      "קופות חולים",
      "תרופות",
      "תרופה",
      "סל הבריאות",
      "בריאות הנפש",
      "רווחה",
      "ביטוח לאומי",
      "קצבה",
      "קצבאות",
      "נכות",
      "נכים",
      "קשישים",
      "סיעוד",
    ],
  },

  {
    id: "education",
    label: "חינוך ותרבות",
    keywords: [
      "חינוך",
      "בית ספר",
      "בתי ספר",
      "תלמיד",
      "תלמידים",
      "מורה",
      "מורים",
      "הוראה",
      "אוניברסיטה",
      "אוניברסיטאות",
      "מכללה",
      "השכלה גבוהה",
      "סטודנט",
      "סטודנטים",
      "תרבות",
      "ספורט",
      "נוער",
      "גן ילדים",
      "גני ילדים",
    ],
  },

  {
    id: "religion",
    label: "דת ומדינה",
    keywords: [
      "דת",
      "דתות",
      "רבנות",
      "רבני",
      "כשרות",
      "כשר",
      "שבת",
      "גיור",
      "נישואין",
      "נישואים",
      "גירושין",
      "בתי דין רבניים",
      "בית דין רבני",
      "מועצה דתית",
      "מועצות דתיות",
      "שירותי דת",
      "קבורה",
    ],
  },

  {
    id: "justice",
    label: "משפט, ממשל ודמוקרטיה",
    keywords: [
      "משפט",
      "משפטים",
      "בית משפט",
      "בתי משפט",
      "שופט",
      "שופטים",
      "שפיטה",
      "בגץ",
      'בג"ץ',
      "עונשין",
      "חקירה",
      "משטרה",
      "פרקליטות",
      "יועץ משפטי",
      "ממשלה",
      "כנסת",
      "בחירות",
      "מפלגה",
      "שירות המדינה",
      "מבקר המדינה",
      "דמוקרטיה",
      "רשות מקומית",
      "רשויות מקומיות",
    ],
  },

  {
    id: "rights",
    label: "זכויות ושוויון",
    keywords: [
      "זכויות",
      "זכות",
      "שוויון",
      "הפליה",
      "אפליה",
      "נשים",
      "אישה",
      "נשים נפגעות",
      "אלימות במשפחה",
      'להט"ב',
      "מגדר",
      "מיעוטים",
      "נגישות",
      "זכויות אדם",
      "חופש הביטוי",
      "פרטיות",
      "הטרדה מינית",
    ],
  },

  {
    id: "environment",
    label: "סביבה, תחבורה ותשתיות",
    keywords: [
      "סביבה",
      "איכות הסביבה",
      "זיהום",
      "אקלים",
      "פסולת",
      "מחזור",
      "תחבורה",
      "תחבורה ציבורית",
      "כביש",
      "כבישים",
      "רכבת",
      "רכב",
      "תשתיות",
      "אנרגיה",
      "חשמל",
      "מים",
      "בנייה",
      "בניה",
      "תכנון ובנייה",
      "מקרקעין",
      "דיור",
    ],
  },

  {
    id: "labor",
    label: "עבודה ותעסוקה",
    keywords: [
      "עבודה",
      "עובד",
      "עובדים",
      "עובדת",
      "תעסוקה",
      "שכר",
      "שכר מינימום",
      "פנסיה",
      "פיצויי פיטורים",
      "חופשה",
      "חופשת לידה",
      "מעסיק",
      "מעסיקים",
      "יחסי עבודה",
      "אבטלה",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[״"]/g, '"')
    .replace(/[׳']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function countOccurrences(text: string, keyword: string): number {
  const normalizedKeyword = normalizeText(keyword);

  if (!normalizedKeyword) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while (true) {
    const index = text.indexOf(normalizedKeyword, position);

    if (index === -1) {
      break;
    }

    count++;
    position = index + normalizedKeyword.length;
  }

  return count;
}

type Bill = {
  id: number;
  title: string;
  summary: string | null;
  committee_name: string | null;
  text_content: string | null;
};

type AgendaScore = {
  id: string;
  label: string;
  score: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

function classifyBill(bill: Bill): AgendaScore[] {
  const title = normalizeText(bill.title);
  const summary = normalizeText(bill.summary);
  const committee = normalizeText(bill.committee_name);
  const fullText = normalizeText(bill.text_content);

  const scores: AgendaScore[] = [];

  for (const agenda of AGENDAS) {
    let score = 0;

    for (const keyword of agenda.keywords) {
      // כותרת החוק מקבלת משקל גבוה
      score += countOccurrences(title, keyword) * 8;

      // ועדה היא אינדיקציה חזקה
      score += countOccurrences(committee, keyword) * 6;

      // תקציר
      score += countOccurrences(summary, keyword) * 4;

      // הטקסט המלא - הרבה יותר ארוך,
      // לכן כל הופעה מקבלת משקל קטן יותר
      score += Math.min(countOccurrences(fullText, keyword), 10);
    }

    if (score > 0) {
      scores.push({
        id: agenda.id,
        label: agenda.label,
        score,
      });
    }
  }

  return scores.sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");

  console.log("Classify Bill Agendas");
  console.log("");

  // טבלה חדשה ששומרת את הסיווג
  db.exec(`
    CREATE TABLE IF NOT EXISTS bill_agenda (
      bill_id      INTEGER NOT NULL,
      agenda_id    TEXT NOT NULL,
      agenda_label TEXT NOT NULL,
      score        REAL NOT NULL,
      is_primary   INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (bill_id, agenda_id)
    )
  `);

  const bills = db
    .prepare(
      `
      SELECT
        id,
        title,
        summary,
        committee_name,
        text_content
      FROM bill
      WHERE text_content IS NOT NULL
        AND text_content != ''
      ORDER BY id
    `,
    )
    .all() as Bill[];

  console.log(`Bills with text to classify: ${bills.length.toLocaleString()}`);

  const deleteBillAgendas = db.prepare(`
    DELETE FROM bill_agenda
    WHERE bill_id = ?
  `);

  const insertAgenda = db.prepare(`
    INSERT OR REPLACE INTO bill_agenda
      (
        bill_id,
        agenda_id,
        agenda_label,
        score,
        is_primary
      )
    VALUES (?, ?, ?, ?, ?)
  `);

  let classified = 0;
  let unclassified = 0;
  let multiAgenda = 0;

  const transaction = db.transaction(() => {
    for (const bill of bills) {
      const scores = classifyBill(bill);

      deleteBillAgendas.run(bill.id);

      if (scores.length === 0) {
        unclassified++;
        continue;
      }

      const primary = scores[0];

      // תמיד שומרים את האג'נדה הראשית
      insertAgenda.run(bill.id, primary.id, primary.label, primary.score, 1);

      classified++;

      // אג'נדה משנית נשמרת רק אם היא מספיק חזקה
      if (scores.length > 1) {
        const secondary = scores[1];

        // לפחות 40% מהניקוד של האג'נדה הראשית
        // וגם ניקוד מינימלי של 5
        if (secondary.score >= 5 && secondary.score >= primary.score * 0.4) {
          insertAgenda.run(
            bill.id,
            secondary.id,
            secondary.label,
            secondary.score,
            0,
          );

          multiAgenda++;
        }
      }
    }
  });

  transaction();

  console.log("");
  console.log("Results:");
  console.log(`  Classified bills   : ${classified.toLocaleString()}`);
  console.log(`  Unclassified bills : ${unclassified.toLocaleString()}`);
  console.log(`  Multi-agenda bills : ${multiAgenda.toLocaleString()}`);

  // ── Agenda distribution ──────────────────────────────────────────────────

  const distribution = db
    .prepare(
      `
      SELECT
        agenda_label,
        COUNT(DISTINCT bill_id) AS bills,
        SUM(CASE WHEN is_primary = 1 THEN 1 ELSE 0 END) AS primary_bills
      FROM bill_agenda
      GROUP BY agenda_id, agenda_label
      ORDER BY primary_bills DESC
    `,
    )
    .all();

  console.log("");
  console.log("Agenda distribution:");
  console.table(distribution);

  // ── Sample ───────────────────────────────────────────────────────────────

  const sample = db
    .prepare(
      `
      SELECT
        b.id,
        b.title,
        ba.agenda_label,
        ba.score,
        ba.is_primary
      FROM bill b
      INNER JOIN bill_agenda ba
        ON ba.bill_id = b.id
      ORDER BY b.id
      LIMIT 20
    `,
    )
    .all();

  console.log("");
  console.log("Sample classified bills:");
  console.table(sample);

  db.close();

  console.log("");
  console.log("Done.");
}

main();
