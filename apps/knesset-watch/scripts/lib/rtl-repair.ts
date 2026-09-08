/**
 * Repair Hebrew text extracted from RTL PDFs with reversed word order.
 *
 * הבעיה: PDF שומר גליפים בסדר חזותי. מחלץ שקורא אותם משמאל לימין מוציא
 * את המילים בסדר הפוך בתוך כל שורה. האותיות בתוך כל מילה תקינות — רק
 * סדר המילים התהפך.
 *
 *   נשמר:  "2196809 :פנימי מספר וחמש העשרים הכנסת"
 *   נכון:  "מספר פנימי: 2196809 ... הכנסת העשרים וחמש"
 *
 * נמדד בארכיון: 91% מ-7,361 המסמכים הפוכים, 6% תקינים, 3% לא מוכרעים.
 * לכן הזיהוי הוא לכל מסמך בנפרד — היפוך גורף היה הורס את התקינים.
 */

/** סימני פיסוק שנצמדים לצד הלא נכון של המילה אחרי ההיפוך */
const LEADING_PUNCT = /^([:,.;!?]+)(.+)$/;

/** סוגריים ומרכאות מתהפכים חזותית ב-RTL */
const MIRRORED: Record<string, string> = {
  '(': ')', ')': '(',
  '[': ']', ']': '[',
  '{': '}', '}': '{',
  '<': '>', '>': '<',
};

/**
 * האם סדר המילים במסמך הפוך.
 *
 * "הצעת חוק" מול "חוק הצעת" הוא הסימן החזק ביותר — הצירוף מופיע כמעט
 * בכל הצעת חוק, וסדר המילים בו חד-משמעי. נבדקים גם צירופים נפוצים
 * אחרים כדי לא להסתמך על סימן יחיד.
 */
export function isReversed(text: string): boolean {
  const probe = text.slice(0, 6000);

  const reversedHits =
    (probe.match(/חוק הצעת/g) ?? []).length +
    (probe.match(/הכנסת חבר/g) ?? []).length +
    (probe.match(/לחוק תיקון/g) ?? []).length;

  const forwardHits =
    (probe.match(/הצעת חוק/g) ?? []).length +
    (probe.match(/חבר הכנסת/g) ?? []).length +
    (probe.match(/תיקון לחוק/g) ?? []).length;

  return reversedHits > forwardHits;
}

/** מחזיר סימן פיסוק פותח לסוף המילה, ומשקף סוגריים */
function fixToken(token: string): string {
  let out = token;

  const match = out.match(LEADING_PUNCT);
  if (match) out = `${match[2]}${match[1]}`;

  return [...out].map(ch => MIRRORED[ch] ?? ch).join('');
}

/**
 * הופך את סדר המילים בכל שורה בנפרד.
 *
 * חשוב שזה יהיה לפי שורה ולא לפי המסמך כולו: כל שורה בקובץ המקורי היא
 * שורה ויזואלית ב-PDF, וההיפוך התרחש בתוכה. היפוך של המסמך כולו היה
 * הופך גם את סדר השורות ומקלקל את מבנה החוק.
 */
export function repairReversedText(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      return trimmed.split(/\s+/).reverse().map(fixToken).join(' ');
    })
    .join('\n');
}

/**
 * מתקן אם צריך, ומדווח מה נעשה.
 * המסמכים התקינים מוחזרים כמות שהם.
 */
export function repairIfReversed(text: string): { text: string; repaired: boolean } {
  if (!isReversed(text)) return { text, repaired: false };
  return { text: repairReversedText(text), repaired: true };
}
