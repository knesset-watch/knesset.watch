'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AGENDAS } from '@/lib/agendas';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Agenda {
  id: string;
  label: string;
  billCount: number;
  voteCount: number;
}

export default function AgendasClient() {
  const router = useRouter();
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAgendas() {
      try {
        const res = await fetch(`${BASE_PATH}/api/agendas`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setAgendas(json.agendas ?? []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetchAgendas();
  }, []);

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={handleBack}
            className="text-sm font-black px-3 py-1.5 rounded border border-black/10 hover:bg-gray-50 transition-colors"
          >
            → חזרה
          </button>
          <div>
            <h1 className="text-2xl font-black leading-tight">אג&apos;נדות מדיניות</h1>
            <p className="text-xs text-gray-400 mt-0.5 font-medium">
              מיקוד החקיקה וההצבעות לפי תחומי עניין — כנסת 25
            </p>
          </div>
        </div>

        {loading && (
          <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">טוען אג&apos;נדות...</div>
        )}

        {error && (
          <div className="p-8 text-center text-red-600 font-black">{error}</div>
        )}

        {/* Topic grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agendas.map(agenda => {
            return (
              <Link
                key={agenda.id}
                href={`/agenda/${encodeURIComponent(agenda.id)}?type=macro`}
                prefetch={false}
                className="block rounded-xl border border-black/8 bg-gray-50 hover:bg-gray-100 transition-colors p-5 group"
              >
                <h2 className="text-base font-black leading-snug mb-2 group-hover:underline">
                  {agenda.label}
                </h2>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black text-gray-700">
                    {agenda.billCount} הצעות חוק
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium">
                    · {agenda.voteCount} הצבעות
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
