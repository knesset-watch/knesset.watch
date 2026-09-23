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

  if (loading) return <div className="text-ui text-mute mt-4">טוען פילוח סיעות...</div>;
  if (!data || data.factions.length === 0) return null;

  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-ui font-semibold text-ink-2 mb-1">פילוח הצבעה לפי סיעה</h3>
      <p className="text-meta text-mute mb-3">
        {data.voteTitle} · {data.voteDate} ·{' '}
        <span className={data.isPassed ? 'text-pass' : 'text-fail'}>
          {data.isPassed ? 'עבר' : 'לא עבר'}
        </span>
      </p>
      <div className="overflow-x-auto">
        {/* min-w מכריח גלילה במעטפת במקום דחיסת העמודות במסך צר */}
        <table className="w-full min-w-[28rem] text-ui border-collapse">
          <thead>
            <tr className="text-meta text-mute border-b border-line-soft">
              <th className="text-right font-medium py-1.5 pr-0 pl-4">סיעה</th>
              <th className="text-center font-medium py-1.5 px-3 text-pass">בעד</th>
              <th className="text-center font-medium py-1.5 px-3 text-fail">נגד</th>
              <th className="text-center font-medium py-1.5 px-3 text-mute">נמנע</th>
            </tr>
          </thead>
          <tbody>
            {data.factions.map(f => (
              <tr key={f.factionName} className="border-b border-line-soft hover:bg-surface-2 transition-colors">
                <td className="py-1.5 pr-0 pl-4 text-ink text-right max-w-[200px] truncate">{f.factionName}</td>
                <td className="py-1.5 px-3 text-center tabular-nums">
                  {f.forCount > 0
                    ? <span className="font-medium text-pass">{f.forCount}</span>
                    : <span className="text-mute">—</span>}
                </td>
                <td className="py-1.5 px-3 text-center tabular-nums">
                  {f.againstCount > 0
                    ? <span className="font-medium text-fail">{f.againstCount}</span>
                    : <span className="text-mute">—</span>}
                </td>
                <td className="py-1.5 px-3 text-center tabular-nums">
                  {f.abstainCount > 0
                    ? <span className="text-mute">{f.abstainCount}</span>
                    : <span className="text-mute">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-meta text-mute border-t border-line">
              <td className="py-1.5 pr-0 pl-4 text-right font-medium">סה״כ</td>
              <td className="py-1.5 px-3 text-center tabular-nums font-medium text-pass">{data.totalFor}</td>
              <td className="py-1.5 px-3 text-center tabular-nums font-medium text-fail">{data.totalAgainst}</td>
              <td className="py-1.5 px-3 text-center tabular-nums font-medium text-mute">{data.totalAbstain}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
