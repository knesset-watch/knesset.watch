/**
 * גרף עמודות זעיר לכרטיס נתון.
 *
 * הוא נמצא כאן כדי להוסיף את מה שהמספר הגדול אינו אומר: 7,537 הצבעות
 * לא מספרות אם הקצב עולה או יורד, ואם הכנסת עבדה ברצף או נעצרה. הוא
 * מצויר מנתונים אמיתיים — סדרה חודשית מ-/api/homepage-stats — ואם אין
 * סדרה הוא פשוט לא מוצג. אין כאן עמודות דקורטיביות.
 *
 * אין בו tooltip ואין אינטראקציה: זו תמונה, לא פקד. הסיכום נמסר
 * במילים ב-aria-label כדי שקורא מסך יקבל את אותו מידע.
 */
export function Sparkline({
  values,
  color,
  label,
}: {
  values: number[];
  /** נבלע ל-currentColor כדי שהצבע ייקבע במחלקה של הכרטיס */
  color?: string;
  /** מה הסדרה סופרת, למשל "הצבעות" — נכנס לתיאור לקורא מסך */
  label: string;
}) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  if (max === 0) return null;

  const BAR = 3;
  const GAP = 1.5;
  const H = 22;
  const width = values.length * BAR + (values.length - 1) * GAP;

  // החודש האחרון מול ממוצע התקופה — זה מה שנמסר במילים
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const last = values[values.length - 1];
  const direction = last > avg * 1.15 ? 'מעל הממוצע' : last < avg * 0.85 ? 'מתחת לממוצע' : 'סביב הממוצע';

  return (
    <svg
      viewBox={`0 0 ${width} ${H}`}
      width={width}
      height={H}
      role="img"
      aria-label={`${label} ב-${values.length} החודשים האחרונים. החודש האחרון ${direction}.`}
      className="overflow-visible"
      style={{ color }}
    >
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * H);
        return (
          <rect
            key={i}
            x={i * (BAR + GAP)}
            y={H - h}
            width={BAR}
            height={h}
            rx={1}
            fill="currentColor"
            /* החודש האחרון מלא, הקודמים דהויים — העין נופלת על ההווה */
            opacity={i === values.length - 1 ? 1 : 0.3}
          />
        );
      })}
    </svg>
  );
}
