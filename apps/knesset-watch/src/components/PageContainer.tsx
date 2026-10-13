/**
 * רוחב התוכן הסטנדרטי של האתר, כפי שנקבע בעמוד הבית: עד 900px, ממורכז,
 * 24px ריפוד בצדדים, וריווח עליון של 32px (40px מרוחב md). עמוד שעוטף את
 * התוכן שלו בזה מיישר קו עם עמוד הבית: אותם שוליים, אותו רוחב כותרות
 * וכרטיסים. היום: עמוד הבית והשאלון; שאר העמודים יעברו לכאן בהדרגה.
 *
 * className מיועד לפריסה הפנימית של העמוד (למשל flex-col gap-16 בעמוד
 * הבית), לא לשינוי הרוחב או השוליים.
 */
export function PageContainer({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[900px] px-6 pt-8 md:pt-10 ${className}`}>{children}</div>;
}
