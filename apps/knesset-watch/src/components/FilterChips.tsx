'use client';

import React from 'react';

interface FilterChip {
  label: string;
  onRemove: () => void;
}

interface FilterChipsProps {
  chips: FilterChip[];
  onClearAll?: () => void;
}

export default function FilterChips({ chips, onClearAll }: FilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 items-center mt-6 pt-4 border-t border-gray-200">
      <span className="text-xs font-black uppercase text-gray-500 tracking-widest">מסננים פעילים:</span>
      {chips.map((chip, idx) => (
        <div
          key={idx}
          className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-full text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
        >
          <span>{chip.label}</span>
          <button
            onClick={chip.onRemove}
            className="ml-1 text-blue-500 hover:text-blue-700 font-bold text-xs leading-none"
            aria-label={`הסר ${chip.label}`}
          >
            ✕
          </button>
        </div>
      ))}
      {onClearAll && chips.length > 1 && (
        <button
          onClick={onClearAll}
          className="ml-2 text-xs font-bold text-gray-500 hover:text-gray-700 underline"
        >
          נקה הכל
        </button>
      )}
    </div>
  );
}
