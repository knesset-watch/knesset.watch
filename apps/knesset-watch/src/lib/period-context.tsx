'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Period values:
//   'all'                        — all K25 data (no date filter)
//   '2023' | '2024' | '2025' | '2026' — full calendar year
//   'custom:YYYY-MM-DD:YYYY-MM-DD'    — arbitrary date range
export type Period = string;

export interface PeriodOption {
  value: string;
  label: string;
}

export const PERIOD_SHORTCUTS: PeriodOption[] = [
  { value: 'all',  label: 'כנסת 25' },
  { value: '2026', label: '2026' },
  { value: '2025', label: '2025' },
  { value: '2024', label: '2024' },
  { value: '2023', label: '2023' },
];

/** @deprecated Use PERIOD_SHORTCUTS instead */
export const PERIODS = PERIOD_SHORTCUTS;

/** Returns YYYY-MM-DD bounds for a period, or null for 'all'. */
export function periodToDateRange(period: Period): { from: string; to: string } | null {
  if (!period || period === 'all') return null;
  if (period.startsWith('custom:')) {
    const rest = period.slice(7);
    const colon = rest.indexOf(':');
    if (colon > 0) return { from: rest.slice(0, colon), to: rest.slice(colon + 1) };
    return null;
  }
  const year = period.match(/^(\d{4})$/)?.[1];
  if (year) return { from: `${year}-01-01`, to: `${year}-12-31` };
  return null;
}

/** Human-readable label for any period value. */
export function periodLabel(period: Period): string {
  const shortcut = PERIOD_SHORTCUTS.find(s => s.value === period);
  if (shortcut) return shortcut.label;
  if (period.startsWith('custom:')) {
    const rest = period.slice(7);
    const colon = rest.indexOf(':');
    if (colon > 0) {
      const from = rest.slice(0, colon).slice(0, 7);   // YYYY-MM
      const to   = rest.slice(colon + 1).slice(0, 7);  // YYYY-MM
      if (from === to) return from;
      // If same year, show "Jan–Mar 2025" style
      if (from.slice(0, 4) === to.slice(0, 4)) return `${from.slice(5)}–${to.slice(5)} ${from.slice(0, 4)}`;
      return `${from} – ${to}`;
    }
  }
  return period;
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
const KNOWN_VALUES = new Set(PERIOD_SHORTCUTS.map(p => p.value));

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriodState] = useState<Period>('all');

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (stored && (KNOWN_VALUES.has(stored) || stored.startsWith('custom:'))) {
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
