'use client';
import { useEffect, useState } from 'react';

interface TimelineEvent {
  type: 'bill' | 'vote' | 'query';
  date: string;
  title: string;
  detail: string;
  sourceId: number;
}

const TYPE_LABELS: Record<TimelineEvent['type'], string> = {
  bill: 'הצ"ח',
  vote: 'הצבעה',
  query: 'שאילתה',
};

const TYPE_COLORS: Record<TimelineEvent['type'], string> = {
  bill: 'bg-blue-100 text-blue-800',
  vote: 'bg-purple-100 text-purple-800',
  query: 'bg-green-100 text-green-800',
};

const TYPE_LINKS: Record<TimelineEvent['type'], (id: number) => string> = {
  bill: id => `/bill/${id}`,
  vote: id => `/vote/${id}`,
  query: () => '',
};

export function MkTimeline({ query, topicKeywords }: { query: string; topicKeywords: string[] }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [mkName, setMkName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!query) return;
    setLoading(true);
    const kw = topicKeywords.join(',');
    fetch(`/api/mk-timeline?q=${encodeURIComponent(query)}&kw=${encodeURIComponent(kw)}`)
      .then(r => r.json())
      .then((data: { events: TimelineEvent[]; mkName: string | null }) => {
        setEvents(data.events);
        setMkName(data.mkName);
      })
      .catch(() => { /* silent — timeline is non-critical */ })
      .finally(() => setLoading(false));
  }, [query, topicKeywords]);

  if (loading) return <div className="text-sm text-gray-400 mt-4">טוען ציר זמן...</div>;
  if (!mkName || events.length === 0) return null;

  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-sm font-semibold text-gray-600 mb-3">פעילות {mkName} בנושא</h3>
      <div className="space-y-2">
        {events.map((event, i) => {
          const href = TYPE_LINKS[event.type](event.sourceId);
          const row = (
            <div key={i} className="flex items-start gap-3 text-sm">
              <span className="text-gray-400 w-20 shrink-0 tabular-nums">{event.date}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_COLORS[event.type]}`}>
                {TYPE_LABELS[event.type]}
              </span>
              <span className="text-gray-800">
                {event.title}
                {event.detail && <span className="text-gray-400 mr-1">— {event.detail}</span>}
              </span>
            </div>
          );
          if (href) {
            return (
              <a key={i} href={href} className="block hover:bg-gray-50 rounded -mx-1 px-1 transition-colors">
                {row}
              </a>
            );
          }
          return row;
        })}
      </div>
    </div>
  );
}
