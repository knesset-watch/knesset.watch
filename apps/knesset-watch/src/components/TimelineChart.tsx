'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { COLOR, TOPIC_COLOR, TOPIC_FALLBACK } from '@/lib/ui/colors';

interface TimelineChartProps {
  data: { month: string; agenda: string; count: number }[];
}

// הפלטה משותפת עם הצ׳יפים והכרטיסים — ראו lib/ui/colors.ts

export default function TimelineChart({ data }: TimelineChartProps) {
  const { chartData, keys } = useMemo(() => {
    const monthsMap = new Map<string, Record<string, string | number>>();
    const uniqueAgendas = new Set<string>();

    data.forEach(d => {
      if (!monthsMap.has(d.month)) monthsMap.set(d.month, { name: d.month });
      monthsMap.get(d.month)![d.agenda] = d.count;
      uniqueAgendas.add(d.agenda);
    });

    return {
      chartData: Array.from(monthsMap.values())
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      keys: Array.from(uniqueAgendas),
    };
  }, [data]);

  /*
    קודם הוחזר null על מערך ריק, והמסך נשאר חלק בלי שום הסבר. וזה מה
    שקרה תמיד, כי השאילתה קראה עמודה ריקה.
  */
  if (chartData.length === 0) {
    return (
      <div className="w-full rounded-card border border-line bg-surface p-8 text-center" dir="rtl">
        <p className="text-ui text-ink-2">אין נתוני חקיקה לתקופה שנבחרה.</p>
        <p className="text-meta text-mute mt-1">נסי לבחור טווח תאריכים רחב יותר.</p>
      </div>
    );
  }

  return (
    <div className="w-full h-[500px] rounded-card border border-line bg-surface p-4 pt-10" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLOR.line} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12.5, fill: COLOR.mute }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(val: string) => {
              const [y, m] = val.split('-');
              return `${m}/${y.slice(2)}`;
            }}
          />
          <YAxis tick={{ fontSize: 12.5, fill: COLOR.mute }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: COLOR.surface2 }}
            contentStyle={{
              borderRadius: '0.75rem',
              border: `1px solid ${COLOR.line}`,
              background: COLOR.surface,
              fontFamily: 'var(--font-assistant)',
              fontSize: '13px',
              textAlign: 'right',
              direction: 'rtl',
            }}
            itemStyle={{ fontWeight: 500 }}
          />
          {/* משקל 900 על עברית קטנה סותם את האותיות; 500 מספיק לתווית */}
          <Legend wrapperStyle={{ fontFamily: 'var(--font-assistant)', fontSize: '12.5px', fontWeight: 500 }} />
          {keys.map(agenda => (
            <Bar key={agenda} dataKey={agenda} stackId="a" fill={TOPIC_COLOR[agenda] ?? TOPIC_FALLBACK} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
