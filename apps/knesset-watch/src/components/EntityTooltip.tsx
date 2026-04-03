'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface MkPreview {
  id: number;
  name: string;
  factionName: string | null;
  isCoalition: boolean | null;
  ministerRole: string | null;
  proposed: number;
  passed: number;
  committeeSessions: number;
}

interface CommitteePreview {
  name: string;
  sessionCount: number;
  lastDate: string | null;
  memberCount: number;
}

type PreviewData = { type: 'mk'; data: MkPreview } | { type: 'committee'; data: CommitteePreview };

const cache = new Map<string, PreviewData>();

interface Props {
  href: string;
  type: 'mk' | 'committee';
  id: string | number;
  children: React.ReactNode;
  className?: string;
}

export default function EntityTooltip({ href, type, id, children, className }: Props) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const cacheKey = `${type}:${id}`;

  function showTooltip(e: React.MouseEvent) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPos({ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX });
      setVisible(true);
      if (!cache.has(cacheKey)) {
        try {
          const url = type === 'mk'
            ? `${BASE_PATH}/api/preview/mk/${id}`
            : `${BASE_PATH}/api/preview/committee/${encodeURIComponent(String(id))}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const entry: PreviewData = type === 'mk'
              ? { type: 'mk', data: data as MkPreview }
              : { type: 'committee', data: data as CommitteePreview };
            cache.set(cacheKey, entry);
            setPreview(entry);
          }
        } catch { /* silent */ }
      } else {
        setPreview(cache.get(cacheKey)!);
      }
    }, 280);
  }

  function hideTooltip() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <>
      <Link
        href={href}
        className={className}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        ref={wrapRef as React.RefObject<HTMLAnchorElement>}
      >
        {children}
      </Link>

      {visible && preview && (
        <div
          className="fixed z-50 bg-white border border-black/10 rounded-2xl shadow-xl p-4 w-64 pointer-events-none"
          style={{ top: pos.top, left: pos.left }}
          dir="rtl"
        >
          {preview.type === 'mk' && (
            <>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="text-sm font-black leading-tight">{preview.data.name}</p>
                  {preview.data.factionName && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{preview.data.factionName}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {preview.data.isCoalition !== null && (
                    <span className={`text-[11px] font-black uppercase px-1.5 py-0.5 rounded-full ${
                      preview.data.isCoalition ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
                    }`}>
                      {preview.data.isCoalition ? 'קואליציה' : 'אופוזיציה'}
                    </span>
                  )}
                  {preview.data.ministerRole && (
                    <span className="text-[11px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-400 text-white">שר</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-black/5 pt-3">
                <div className="flex flex-col">
                  <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">הצעות</span>
                  <span className="text-xl font-black">{preview.data.proposed}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">עברו</span>
                  <span className="text-xl font-black text-teal-600">{preview.data.passed}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">ועדות</span>
                  <span className="text-xl font-black text-blue-700">{preview.data.committeeSessions}</span>
                </div>
              </div>
            </>
          )}

          {preview.type === 'committee' && (
            <>
              <p className="text-sm font-black leading-snug mb-3">{preview.data.name}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">ישיבות</span>
                  <span className="text-xl font-black">{preview.data.sessionCount.toLocaleString('he-IL')}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">חברים</span>
                  <span className="text-xl font-black">{preview.data.memberCount}</span>
                </div>
              </div>
              {preview.data.lastDate && (
                <p className="text-[11px] text-teal-700 font-bold mt-2">
                  דיון אחרון: {new Date(preview.data.lastDate).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
