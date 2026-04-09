'use client';
import { useEffect, useState } from 'react';
import type { VoteCoalitionData } from '@/lib/knesset-db';

export function VoteCoalition({ voteId }: { voteId: number }) {
  const [data, setData] = useState<VoteCoalitionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/vote-coalition?voteId=${voteId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: VoteCoalitionData | null) => setData(d))
      .catch(() => { /* silent — coalition is non-critical */ })
      .finally(() => setLoading(false));
  }, [voteId]);

  if (loading) return <div className="text-sm text-gray-400 mt-4">טוען פילוח סיעות...</div>;
  if (!data || data.factions.length === 0) return null;

  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-sm font-semibold text-gray-600 mb-1">פילוח הצבעה לפי סיעה</h3>
      <p className="text-xs text-gray-400 mb-3">
        {data.voteTitle} · {data.voteDate} ·{' '}
        <span className={data.isPassed ? 'text-green-600' : 'text-red-600'}>
          {data.isPassed ? 'עבר' : 'לא עבר'}
        </span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="text-right font-medium py-1.5 pr-0 pl-4">סיעה</th>
              <th className="text-center font-medium py-1.5 px-3 text-green-700">בעד</th>
              <th className="text-center font-medium py-1.5 px-3 text-red-600">נגד</th>
              <th className="text-center font-medium py-1.5 px-3 text-gray-500">נמנע</th>
            </tr>
          </thead>
          <tbody>
            {data.factions.map(f => (
              <tr key={f.factionName} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="py-1.5 pr-0 pl-4 text-gray-800 text-right max-w-[200px] truncate">{f.factionName}</td>
                <td className="py-1.5 px-3 text-center tabular-nums">
                  {f.forCount > 0
                    ? <span className="font-medium text-green-700">{f.forCount}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="py-1.5 px-3 text-center tabular-nums">
                  {f.againstCount > 0
                    ? <span className="font-medium text-red-600">{f.againstCount}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="py-1.5 px-3 text-center tabular-nums">
                  {f.abstainCount > 0
                    ? <span className="text-gray-500">{f.abstainCount}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-xs text-gray-400 border-t border-gray-200">
              <td className="py-1.5 pr-0 pl-4 text-right font-medium">סה״כ</td>
              <td className="py-1.5 px-3 text-center tabular-nums font-medium text-green-700">{data.totalFor}</td>
              <td className="py-1.5 px-3 text-center tabular-nums font-medium text-red-600">{data.totalAgainst}</td>
              <td className="py-1.5 px-3 text-center tabular-nums font-medium text-gray-500">{data.totalAbstain}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
