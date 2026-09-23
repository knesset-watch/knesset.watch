'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS, AI_LINK, isNavActive } from '@/lib/nav';

/** aiEnabled מגיע מ-layout: דגל שרת שמאפשר לכבות את פיצ׳רי ה-AI */
export default function AppSidebar({ aiEnabled = true }: { aiEnabled?: boolean }) {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  return (
    /*
      הסיידבר כהה — נייבי על גוף בהיר. זה מה שמפריד בין הניווט לתוכן
      בלי קו מפריד ובלי צל, ומשחרר את הזהב: על הנייבי הוא 6.8:1 ואפשר
      להשתמש בו כטקסט, לא רק כגבול.
    */
    <aside
      className="hidden md:flex flex-col w-54 shrink-0 bg-navy-deep sticky top-0 h-screen overflow-y-auto"
      data-surface="dark"
      dir="rtl"
    >
      <div className="px-4 pt-5 pb-4 border-b border-white/10">
        <Link
          href="/"
          className="flex flex-col items-center gap-2 rounded-control p-2 hover:bg-white/5 transition-colors"
          aria-label="אפרכסת לכנסת — דף הבית"
        >
          <img
            src="/logo-dark.svg"
            alt=""
            className="h-16 w-auto"
          />
          <span className="font-content text-section font-bold text-white">
            אפרכסת לכנסת
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-6" aria-label="ניווט ראשי">
        {NAV_GROUPS.map(({ group, links }) => (
          <div key={group}>
            {/* לעברית אין אותיות רישיות; הכותרת מסומנת במשקל ובלובן, לא ב-tracking */}
            <p className="text-ui font-bold text-white px-2 mb-1.5">{group}</p>
            {links.map(({ href, label, prefixes }) => {
              const active = isNavActive(pathname, prefixes);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center px-2 py-2 rounded-control text-ui border-r-2 transition-colors ${
                    active
                      ? 'bg-white/10 text-accent-lit font-medium border-accent-lit'
                      : 'text-navy-mute border-transparent hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {aiEnabled && (
      <div className="px-2 pb-4 border-t border-white/10 pt-3">
        <Link
          href={AI_LINK.href}
          aria-current={isNavActive(pathname, AI_LINK.prefixes) ? 'page' : undefined}
          className={`flex items-center gap-2 px-2 py-2 rounded-control text-ui font-medium transition-colors ${
            isNavActive(pathname, AI_LINK.prefixes)
              ? 'bg-accent-lit text-navy-deep'
              : 'text-accent-lit hover:bg-white/10'
          }`}
        >
          <span aria-hidden="true">✦</span>
          {AI_LINK.label}
        </Link>
      </div>
      )}
    </aside>
  );
}
