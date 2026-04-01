'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Shown on all pages except the home page, which has its own sidebar nav.
export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname === '/') return null;

  return (
    <header
      className="sticky top-0 z-30 w-full bg-white/90 backdrop-blur border-b border-black/8"
      dir="rtl"
    >
      <div className="max-w-6xl mx-auto px-4 h-11 flex items-center justify-between">
        <Link href="/" className="text-base font-black tracking-tighter hover:opacity-70 transition-opacity">
          כנסת ווטש
        </Link>
        <nav className="hidden sm:flex items-center gap-1 text-xs font-black text-gray-500">
          <Link href="/committees" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">ועדות</Link>
          <Link href="/protocols" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">פרוטוקולים</Link>
          <Link href="/bills" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">ספר החוקים</Link>
          <Link href="/ministers" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">שרים</Link>
        </nav>
      </div>
    </header>
  );
}
