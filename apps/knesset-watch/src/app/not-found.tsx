import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start px-6 py-24" dir="rtl">
      <p className="label-he mb-2">שגיאה 404</p>
      <h1 className="text-page mb-3">הדף הזה לא קיים</h1>
      <p className="text-body text-mute font-content mb-8">
        ייתכן שהכתובת השתנתה, או שהח&quot;כ, החוק או הוועדה שחיפשת אינם במסד הנתונים.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-control bg-accent px-4 py-2.5 text-ui font-medium text-white transition-colors hover:bg-accent-ink"
        >
          לדף הבית
        </Link>
        <Link
          href="/mks"
          className="rounded-control border border-line bg-surface px-4 py-2.5 text-ui text-ink-2 transition-colors hover:border-accent"
        >
          לרשימת הח&quot;כים
        </Link>
      </div>
    </div>
  );
}
