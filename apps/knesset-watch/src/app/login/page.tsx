import { redirect } from 'next/navigation';
import { LoginForm } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * שער הסיסמה.
 *
 * כשאין SITE_PASSWORD מוגדר האתר ציבורי, ואז אין לעמוד הזה מה להציע:
 * הטופס יוצג אבל שום סיסמה לא תתקבל, כי הבדיקה ב-/api/auth היא
 * `password && password === sitePassword` ושני הצדדים ריקים. זה אינו
 * חור אבטחה — נבדק, כל הניסיונות חוזרים 401 — אבל מי שיגיע לכאן
 * מקישור ישן, מסימנייה או מתוצאת חיפוש יראה דלת נעולה באתר פתוח וילך.
 *
 * לכן: אין סיסמה, אין עמוד.
 */
export default function LoginPage() {
  const sitePassword = (process.env.SITE_PASSWORD ?? '').trim();
  if (!sitePassword) redirect('/');

  return (
    <LoginForm
      title="אפרכסת לכנסת"
      endpoint="/api/auth"
      onSuccessRedirect="/"
      cookieName="knesset-watch_auth_token"
    />
  );
}
