'use client';

import { useState, useEffect } from 'react';

export default function PulsePOC() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPulse() {
      try {
        const res = await fetch('/knesset-watch/api/pulse');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
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
          </div>
        ) : data ? (
          <div className="space-y-6">
            <div className="text-sm font-bold text-gray-500">חוקים שעברו סופית ב-30 הימים האחרונים:</div>
            <div className="text-[120px] font-black leading-none tracking-tighter">
              {data.count}
            </div>
            
            {data.latestBills && data.latestBills.length > 0 && (
              <div className="pt-8 border-t-2 border-black/10 mt-8">
                <div className="text-[11px] font-black uppercase mb-4 text-gray-400">חקיקה אחרונה:</div>
                <ul className="space-y-3">
                  {data.latestBills.map((bill: string, i: number) => (
                    <li key={i} className="text-sm font-bold leading-tight">
                      {bill}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-red-600 font-bold">שגיאה בטעינת נתונים</div>
        )}
      </div>
    </div>
  );
}
