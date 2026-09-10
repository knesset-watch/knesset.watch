'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS, AI_LINK, isNavActive } from '@/lib/nav';

/** aiEnabled מגיע מ-layout: דגל שרת שמאפשר לכבות את פיצ׳רי ה-AI */
export default function AppSidebar({ aiEnabled = true }: { aiEnabled?: boolean }) {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  return (
    <aside
      className="hidden md:flex flex-col w-52 shrink-0 border-l border-line bg-surface sticky top-0 h-screen overflow-y-auto"
      dir="rtl"
    >
      <div className="px-4 pt-4 pb-3 border-b border-line">
        <Link
          href="/"
          className="block font-content text-section font-bold hover:text-accent transition-colors"
        >
          אפרכסת לכנסת
        </Link>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-6" aria-label="ניווט ראשי">
        {NAV_GROUPS.map(({ group, links }) => (
          <div key={group}>
            <p className="text-ui font-bold text-ink px-2 mb-1.5">{group}</p>
            {links.map(({ href, label, prefixes }) => {
              const active = isNavActive(pathname, prefixes);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center px-2 py-2 rounded-control text-ui border-r-2 transition-colors ${
                    active
                      ? 'bg-accent-wash text-accent-ink font-medium border-accent'
                      : 'text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink'
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
      <div className="px-2 pb-4 border-t border-line pt-3">
        <Link
          href={AI_LINK.href}
          aria-current={isNavActive(pathname, AI_LINK.prefixes) ? 'page' : undefined}
          className={`flex items-center gap-2 px-2 py-2 rounded-control text-ui font-medium transition-colors ${
            isNavActive(pathname, AI_LINK.prefixes)
              ? 'bg-accent text-white'
              : 'bg-accent-wash text-accent-ink hover:bg-accent hover:text-white'
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
