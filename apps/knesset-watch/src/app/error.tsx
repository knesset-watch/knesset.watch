'use client';

import { useEffect } from 'react';

/**
 * גבול שגיאה ברמת המסלול.
 *
 * לפני זה לא היה אף error.tsx באתר, וכשל ב-fetch נבלע בשקט
 * (.catch(() => {})) — המשתמשת ראתה מסך חסר בלי שום הסבר.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-start px-6 py-24" dir="rtl" role="alert">
      <p className="label-he mb-2">שגיאה</p>
      <h1 className="text-page mb-3">משהו נשבר בטעינת הדף</h1>
      <p className="text-body text-mute font-content mb-8">
        זו תקלה אצלנו, לא אצלך. אפשר לנסות לטעון שוב — ואם זה חוזר, הנתונים
        של המקטע הזה כנראה לא זמינים כרגע.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={reset}
          className="rounded-control bg-accent px-4 py-2.5 text-ui font-medium text-white transition-colors hover:bg-accent-ink"
        >
          נסי שוב
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
            ניווט קשיח במכוון: <Link> נשאר בתוך עץ ה-React שכבר נשבר. */}
        <a
          href="/"
          className="rounded-control border border-line bg-surface px-4 py-2.5 text-ui text-ink-2 transition-colors hover:border-accent"
        >
          לדף הבית
        </a>
      </div>

      {error.digest && (
        <p className="text-meta text-mute mt-8">
          מזהה התקלה: <span data-numeric>{error.digest}</span>
        </p>
      )}
    </div>
  );
}
