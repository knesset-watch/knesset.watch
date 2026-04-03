'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { MkAgendaData, MkAgendaTopic } from '@/lib/vote-cache';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const RESULT_COLORS: Record<string, string> = {
  'בעד':  'bg-[#16A34A] text-white',
  'נגד':  'bg-[#2563EB] text-white',
  'נמנע': 'bg-amber-100 text-amber-800',
  'נוכח': 'bg-zinc-100 text-zinc-500',
};

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' });
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '—';
  return Math.round((num / denom) * 100) + '%';
}

function topicStats(topic: MkAgendaTopic) {
  const forCount     = topic.votes.filter(v => v.result === 'בעד').length;
  const againstCount = topic.votes.filter(v => v.result === 'נגד').length;
  const abstainCount = topic.votes.filter(v => v.result === 'נמנע').length;
  const voting = forCount + againstCount;
  return { forCount, againstCount, abstainCount, voting };
}

export default function MKAgendaView({ mkId, limit }: { mkId: string; limit?: number }) {
  const [data, setData] = useState<MkAgendaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE_PATH}/api/mk-agenda?mkId=${mkId}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch(e => setError(e.message));
  }, [mkId]);

  if (error) {
    return <div className="py-16 text-center text-red-600 font-black">{error}</div>;
  }

  if (!data) {
    return (
      <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">
        טוען אג&apos;נדה...
      </div>
    );
  }

  const topics = limit != null ? data.topics.slice(0, limit) : data.topics;

  return (
    <div className="flex flex-col gap-2">
      {topics.map(topic => {
        const { forCount, againstCount, abstainCount, voting } = topicStats(topic);
        const isExpanded = expanded === topic.topicId;
        const totalVotes = topic.votes.length;

        return (
          <div key={topic.topicId} className="rounded-xl border border-black/8 overflow-hidden">
            <button
              onClick={() => totalVotes > 0 && setExpanded(isExpanded ? null : topic.topicId)}
              className="w-full text-right"
            >
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">

                {/* Topic name */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-black leading-snug">{topic.label}</h3>
                  <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                    {totalVotes === 0 ? 'לא נמצאו הצבעות' : `${totalVotes} הצבעות`}
                  </p>
                </div>

                {/* Stats */}
                {totalVotes > 0 && (
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex gap-2 text-[11px] font-black">
                      <span className="text-[#16A34A]">{forCount} בעד</span>
                      <span className="text-[#2563EB]">{againstCount} נגד</span>
                      {abstainCount > 0 && (
                        <span className="text-amber-700">{abstainCount} נמנע</span>
                      )}
                    </div>

                    {/* Support bar */}
                    <div className="w-20 h-2 rounded-full bg-gray-200 overflow-hidden flex shrink-0">
                      {voting > 0 && (
                        <>
                          <div className="h-full bg-[#16A34A]" style={{ width: `${Math.round((forCount / voting) * 100)}%` }} />
                          <div className="h-full bg-[#2563EB]" style={{ width: `${Math.round((againstCount / voting) * 100)}%` }} />
                        </>
                      )}
                    </div>

                    <span className="text-xs font-black w-8 text-left tabular-nums">
                      {pct(forCount, voting)}
                    </span>
                  </div>
                )}

                {totalVotes > 0 && (
                  <span className="text-gray-400 text-[11px] font-bold shrink-0">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                )}
              </div>
            </button>

            {/* Expanded vote list */}
            {isExpanded && (
              <div className="divide-y divide-black/[0.04]">
                {topic.votes.map(v => (
                  <div key={v.voteId} className="flex items-center gap-3 px-4 py-2.5">
                    {v.result ? (
                      <span className={`shrink-0 text-[11px] font-black px-2 py-0.5 rounded-full ${RESULT_COLORS[v.result] ?? 'bg-zinc-100 text-zinc-500'}`}>
                        {v.result}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] font-black px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-400">
                        לא הצביע
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/vote/${v.voteId}`}
                        prefetch={false}
                        className="text-sm font-medium text-gray-900 hover:underline leading-snug block"
                      >
                        {v.title || '—'}
                      </Link>
                    </div>
                    <span className="shrink-0 text-[11px] text-gray-500 font-medium tabular-nums">
                      {formatDate(v.date)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
