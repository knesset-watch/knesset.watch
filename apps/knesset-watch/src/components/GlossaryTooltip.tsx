'use client';

import { useState, useRef, useEffect } from 'react';
import { GLOSSARY } from '@/lib/glossary';

interface GlossaryTooltipProps {
  term: keyof typeof GLOSSARY;
  children: React.ReactNode;
  className?: string;
}

export default function GlossaryTooltip({ term, children, className = '' }: GlossaryTooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<'top' | 'bottom'>('top');
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const entry = GLOSSARY[term];

  useEffect(() => {
    if (!showTooltip || !triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    // Check if tooltip would go off bottom of screen
    if (triggerRect.bottom + tooltipRect.height + 10 > window.innerHeight) {
      setTooltipPos('top');
    } else {
      setTooltipPos('bottom');
    }
  }, [showTooltip]);

  return (
    <div className="relative inline-block">
      <div
        ref={triggerRef}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`inline-flex items-center gap-1 cursor-help ${className}`}
      >
        {children}
        <span className="text-[11px] font-black text-blue-600 hover:text-blue-800 transition-colors">?</span>
      </div>

      {showTooltip && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 bg-gray-900 text-white text-sm rounded-lg px-3 py-2 shadow-lg border border-gray-700 whitespace-normal max-w-xs ${
            tooltipPos === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          } left-1/2 transform -translate-x-1/2`}
        >
          <div className="font-bold mb-1">{entry.label}</div>
          <div className="text-xs text-gray-300">{entry.definition}</div>
          <div className="absolute left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-gray-900"
            style={{
              [tooltipPos === 'top' ? 'top' : 'bottom']: '-4px',
              borderTop: tooltipPos === 'bottom' ? 'none' : '4px solid rgb(17, 24, 39)',
              borderBottom: tooltipPos === 'top' ? 'none' : '4px solid rgb(17, 24, 39)',
            }}
          />
        </div>
      )}
    </div>
  );
}
