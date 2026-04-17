'use client';

import { useState, useEffect } from 'react';

export default function PulsePage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPulse = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pulse');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('Pulse fetch error:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPulse();
  }, []);

  return (
    <div className="min-h-screen bg-white text-black flex items-center justify-center p-8 font-[family-name:var(--font-frank-ruhl)]" dir="rtl">
      <div className="max-w-md w-full border-[12px] border-black p-12 shadow-[20px_20px_0px_0px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-2 mb-8">
          <span className="h-3 w-3 bg-red-600 rounded-full animate-pulse"></span>
          <span className="text-xs font-black uppercase tracking-widest">Live: דופק הכנסת</span>
        </div>

        {loading ? (
          <div className="space-y-4">
            <div className="h-20 bg-gray-100 animate-pulse"></div>
            <div className="h-4 bg-gray-100 animate-pulse w-3/4"></div>
            <div className="text-xs text-gray-400">טוען...</div>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="text-red-600 font-bold text-sm">
              ⚠️ שגיאה בטעינת הנתונים
            </div>
            <div className="text-xs text-gray-600 mb-4">
              {error}
            </div>
            <button
              onClick={() => fetchPulse()}
              className="w-full px-4 py-2 bg-black text-white font-bold text-sm rounded hover:bg-gray-800 transition-colors"
            >
              נסו שנית
            </button>
          </div>
        ) : data && (data.bills?.length > 0 || data.count >= 0) ? (
          <div className="space-y-6">
            <div className="text-sm font-bold text-gray-500">חוקים שעברו סופית:</div>
            <div className="text-[120px] font-black leading-none tracking-tighter">
              {data.count || data.bills?.length || 0}
            </div>

            {data.bills && data.bills.length > 0 && (
              <div className="pt-8 border-t-2 border-black/10 mt-8">
                <div className="text-[11px] font-black uppercase mb-4 text-gray-400">אחרונות:</div>
                <ul className="space-y-3">
                  {data.bills.slice(0, 3).map((bill: any, i: number) => (
                    <li key={i} className="text-sm font-bold leading-tight">
                      {typeof bill === 'string' ? bill : bill.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-gray-600 font-bold text-sm">
              אין נתונים זמינים
            </div>
            <button
              onClick={() => fetchPulse()}
              className="w-full px-4 py-2 bg-black text-white font-bold text-sm rounded hover:bg-gray-800 transition-colors"
            >
              רענן
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
