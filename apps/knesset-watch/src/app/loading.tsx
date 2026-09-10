/**
 * מצב טעינה ברמת המסלול.
 *
 * לפני זה לא היה אף loading.tsx ב-25 המסלולים, ו-20 קבצים מימשו טעינה
 * לבד בשלושה ניבים שונים (44 × animate-pulse, 4 × animate-spin,
 * 23 × הטקסט "טוען"). זה הניב האחד.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16" dir="rtl">
      <span className="sr-only" role="status">טוען…</span>

      <div className="animate-pulse space-y-8" aria-hidden="true">
        <div className="h-9 w-64 rounded bg-surface-2" />
        <div className="space-y-2">
          <div className="h-4 w-full max-w-xl rounded bg-surface-2" />
          <div className="h-4 w-full max-w-md rounded bg-surface-2" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-card border border-line bg-surface" />
          ))}
        </div>
      </div>
    </div>
  );
}
