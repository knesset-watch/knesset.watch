'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Period = 'all' | '2023' | '2024' | '2025' | '2026';

export interface PeriodOption {
  value: Period;
  label: string;
}

export const PERIODS: PeriodOption[] = [
  { value: 'all',  label: 'כל הכנסת' },
  { value: '2023', label: '2023' },
  { value: '2024', label: '2024' },
  { value: '2025', label: '2025' },
  { value: '2026', label: '2026' },
];

/** Returns YYYY-MM-DD bounds for a period, or null for 'all'. */
export function periodToDateRange(period: Period): { from: string; to: string } | null {
  const ranges: Partial<Record<Period, { from: string; to: string }>> = {
    '2023': { from: '2023-01-01', to: '2023-12-31' },
    '2024': { from: '2024-01-01', to: '2024-12-31' },
    '2025': { from: '2025-01-01', to: '2025-12-31' },
    '2026': { from: '2026-01-01', to: '2026-12-31' },
  };
  return ranges[period] ?? null;
}

// ── Context ───────────────────────────────────────────────────────────────────

interface PeriodContextValue {
  period: Period;
  setPeriod: (p: Period) => void;
}

const PeriodContext = createContext<PeriodContextValue>({
  period: 'all',
  setPeriod: () => {},
});

const LS_KEY = 'kw-period';

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriodState] = useState<Period>('all');

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY) as Period | null;
    if (stored && PERIODS.some(p => p.value === stored)) {
      setPeriodState(stored);
    }
  }, []);

  const setPeriod = useCallback((p: Period) => {
    setPeriodState(p);
    if (p === 'all') {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, p);
    }
  }, []);

  return (
    <PeriodContext.Provider value={{ period, setPeriod }}>
      {children}
    </PeriodContext.Provider>
  );
}

export function usePeriod() {
  return useContext(PeriodContext);
}
