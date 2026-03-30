'use client';

import { useEffect, useState } from 'react';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface HeatmapDay {
  date: string;
  total: number;
  attended: number;
  rate: number;
}

export default function PresenceHeatmap({ mkId }: { mkId: string }) {
  const [data, setData] = useState<HeatmapDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE_PATH}/api/mk-presence?mkId=${mkId}`)
      .then(r => r.json())
      .then(j => {
        if (j.heatmap) setData(j.heatmap);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [mkId]);

  if (loading) return <div className="h-24 bg-gray-50 rounded-xl animate-pulse" />;
  if (data.length === 0) return null;

  return (
    <div className="bg-white border border-black/8 rounded-2xl p-6" dir="ltr">
      <div className="flex items-center justify-between mb-4" dir="rtl">
        <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide">מפת נוכחות במליאה (שנה אחרונה)</div>
        <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase">
          <span>נעדר</span>
          <div className="flex gap-1">
            <span className="w-3 h-3 rounded-sm bg-rose-500"></span>
            <span className="w-3 h-3 rounded-sm bg-rose-300"></span>
            <span className="w-3 h-3 rounded-sm bg-teal-300"></span>
            <span className="w-3 h-3 rounded-sm bg-teal-500"></span>
          </div>
          <span>נוכח</span>
        </div>
      </div>
      
      <div className="flex gap-1 overflow-x-auto no-scrollbar pb-2">
        {data.map(day => {
          let color = 'bg-gray-100'; // Default, no votes
          if (day.total > 0) {
            if (day.rate === 0) color = 'bg-rose-500';
            else if (day.rate < 0.5) color = 'bg-rose-300';
            else if (day.rate < 0.9) color = 'bg-teal-300';
            else color = 'bg-teal-500';
          }

          return (
            <div 
              key={day.date} 
              title={`${day.date}: ${day.attended} / ${day.total} הצבעות`}
              className={`w-3 h-8 rounded-sm shrink-0 transition-opacity hover:opacity-70 ${color}`}
            />
          );
        })}
      </div>
    </div>
  );
}
