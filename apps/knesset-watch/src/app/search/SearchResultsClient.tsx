'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface SearchHit {
  type: 'mk' | 'committee' | 'bill';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

const TYPE_LABEL: Record<string, string> = {
  mk: 'ח"כים',
  committee: 'ועדות',
  bill: 'חוקים',
};

const TYPE_ORDER: Array<'mk' | 'committee' | 'bill'> = ['mk', 'committee', 'bill'];

export default function SearchResultsClient({ initialQ }: { initialQ: string }) {
  const [query, setQuery] = useState(initialQ);
  const [submittedQ, setSubmittedQ] = useState(initialQ);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (submittedQ.length < 2) { setResults([]); return; }
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(submittedQ)}`)
      .then(r => r.json())
      .then((d: { results?: SearchHit[] }) => setResults(d.results ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [submittedQ]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length >= 2) {
      setSubmittedQ(q);
      router.replace(`/search?q=${encodeURIComponent(q)}`);
    }
  }

  const grouped = TYPE_ORDER.reduce<Record<string, SearchHit[]>>((acc, t) => {
    acc[t] = results.filter(r => r.type === t);
    return acc;
  }, { mk: [], committee: [], bill: [] });

  const hasResults = results.length > 0;

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black">חיפוש</span>
        </nav>

        <h1 className="text-4xl font-black mb-6">חיפוש</h1>

        {/* Search form */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 mb-8">
          <div className="flex-1 flex items-center border border-black/20 rounded-xl px-4 py-3 bg-gray-50 focus-within:border-black/50 focus-within:bg-white transition-colors">
            <svg className="w-4 h-4 text-gray-400 shrink-0 ml-2" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="6.5" cy="6.5" r="4.5"/><path d="m10 10 4 4"/>
            </svg>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="חפשו ח&quot;כ, ועדה, חוק..."
              className="flex-1 bg-transparent text-sm font-black outline-none placeholder:text-gray-400 placeholder:font-normal"
              dir="rtl"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={query.trim().length < 2}
            className="px-5 py-3 rounded-xl bg-black text-white text-sm font-black disabled:opacity-30 hover:bg-gray-800 transition-colors shrink-0"
          >
            חיפוש
          </button>
        </form>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
            טוען...
          </div>
        )}

        {/* No results */}
        {!loading && submittedQ.length >= 2 && !hasResults && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🔍</div>
            <div className="text-gray-500 text-sm">לא נמצאו תוצאות עבור &quot;{submittedQ}&quot;</div>
          </div>
        )}

        {/* Results grouped by type */}
        {!loading && hasResults && TYPE_ORDER.map(type => {
          const group = grouped[type];
          if (group.length === 0) return null;
          return (
            <div key={type} className="mb-8">
              <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-3">{TYPE_LABEL[type]}</div>
              <div className="flex flex-col gap-1.5">
                {group.map(hit => (
                  <Link
                    key={`${hit.type}-${hit.id}`}
                    href={hit.url}
                    className="flex items-center gap-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black text-gray-900 truncate">{hit.title}</div>
                      {hit.subtitle && (
                        <div className="text-[11px] text-gray-400 mt-0.5 truncate">{hit.subtitle}</div>
                      )}
                    </div>
                    <svg className="w-3.5 h-3.5 text-gray-300 shrink-0 rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="m6 3 5 5-5 5"/>
                    </svg>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
