'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  {
    group: 'אנשים',
    links: [
      { href: '/mks',       label: 'ח"כים',       prefixes: ['/mks', '/mk/'] },
      { href: '/ministers', label: 'שרים',          prefixes: ['/ministers'] },
    ],
  },
  {
    group: 'עבודת הכנסת',
    links: [
      { href: '/votes',      label: 'הצבעות',      prefixes: ['/votes', '/vote/'] },
      { href: '/bills',      label: 'חוקים',        prefixes: ['/bills', '/bill/'] },
      { href: '/protocols',  label: 'פרוטוקולים',   prefixes: ['/protocols', '/session/'] },
      { href: '/committees', label: 'ועדות',        prefixes: ['/committees', '/committee/', '/faction/'] },
    ],
  },
  {
    group: 'ניתוחים & כלים',
    links: [
      { href: '/pulse',        label: 'פולס בזמן אמת', prefixes: ['/pulse'] },
      { href: '/track-record', label: 'מעקב חקיקה',   prefixes: ['/track-record'] },
      { href: '/agendas',      label: 'אג\'נדות',     prefixes: ['/agendas', '/agenda/'] },
    ],
  },
];

export default function AppSidebar() {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  function isActive(prefixes: string[]) {
    return prefixes.some(p => pathname === p || pathname.startsWith(p));
  }

  return (
    <aside
      className="hidden md:flex flex-col w-52 shrink-0 border-l border-black/8 bg-white sticky top-0 h-screen overflow-y-auto"
      dir="rtl"
    >
      {/* Logo */}
      <div className="px-4 pt-4 pb-3 border-b border-black/8">
        <Link href="/" className="text-base font-black tracking-tighter hover:opacity-70 transition-opacity block">
          כנסת ווטש
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-2 py-3 space-y-4">
        {NAV.map(({ group, links }) => (
          <div key={group}>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 px-2 mb-1">{group}</p>
            {links.map(({ href, label, prefixes }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center px-2 py-1.5 rounded-lg text-sm font-black transition-colors ${
                  isActive(prefixes)
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* AI ask — pinned at bottom */}
      <div className="px-2 pb-4 border-t border-black/8 pt-3">
        <Link
          href="/ask"
          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-black transition-colors ${
            isActive(['/ask'])
              ? 'bg-blue-600 text-white'
              : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          }`}
        >
          <span className="text-xs">✦</span>
          שאל AI
        </Link>
      </div>
    </aside>
  );
}
