'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface TimelineChartProps {
  data: { month: string; agenda: string; count: number }[];
}

// Fixed color palette for macro agendas
const AGENDA_COLORS: Record<string, string> = {
  'ביטחון וצבא': '#e11d48', // Red
  'כלכלה ויוקר המחיה': '#10b981', // Green
  'מנהל ומשפט': '#3b82f6', // Blue
  'דת ומדינה': '#8b5cf6', // Purple
  'חינוך ותרבות': '#f59e0b', // Violet
  'סביבה ותשתיות': '#14b8a6', // Teal
  'עבודה ותעסוקה': '#f97316', // Orange
  'שלטון ומינהל': '#64748b', // Slate
  'משפט ופשיעה': '#0f172a', // Dark
  'בריאות ורווחה': '#ec4899', // Amber
  'זכויות אדם ושוויון': '#06b6d4', // Cyan
};

export default function TimelineChart({ data }: TimelineChartProps) {
  const { chartData, keys } = useMemo(() => {
    const monthsMap = new Map<string, any>();
    const uniqueAgendas = new Set<string>();

    data.forEach(d => {
      if (!monthsMap.has(d.month)) {
        monthsMap.set(d.month, { name: d.month });
      }
      monthsMap.get(d.month)[d.agenda] = d.count;
      uniqueAgendas.add(d.agenda);
    });

    return {
      chartData: Array.from(monthsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      keys: Array.from(uniqueAgendas)
    };
  }, [data]);

  if (chartData.length === 0) return null;

  return (
    <div className="w-full h-[500px] bg-white rounded-2xl border border-black/5 p-4 pt-10" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis 
            dataKey="name" 
            tick={{ fontSize: 12, fill: '#6b7280', fontWeight: 900 }} 
            axisLine={false}
            tickLine={false}
            tickFormatter={(val) => {
              const [y, m] = val.split('-');
              return `${m}/${y.slice(2)}`;
            }}
          />
          <YAxis 
            tick={{ fontSize: 12, fill: '#6b7280' }} 
            axisLine={false}
            tickLine={false}
          />
          <Tooltip 
            cursor={{ fill: '#f3f4f6' }}
            contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', fontFamily: 'var(--font-frank-ruhl)', textAlign: 'right', direction: 'rtl' }}
            itemStyle={{ fontWeight: 900, fontSize: '14px' }}
          />
          <Legend wrapperStyle={{ fontFamily: 'var(--font-frank-ruhl)', fontSize: '12px', fontWeight: 900 }} />
          {keys.map(agenda => (
            <Bar 
              key={agenda} 
              dataKey={agenda} 
              stackId="a" 
              fill={AGENDA_COLORS[agenda] || '#9ca3af'} 
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
