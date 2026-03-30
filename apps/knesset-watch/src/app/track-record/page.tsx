'use client';

import { useState, useEffect } from 'react';

const SAMPLE_MKS = [
  { id: 30055, name: "בצלאל סמוטריץ'" },
  { id: 23594, name: "יאיר לפיד" },
  { id: 965, name: "בנימין נתניהו" },
  { id: 23565, name: "מירב מיכאלי" },
  { id: 30811, name: "איתמר בן גביר" }
];

interface Bill {
  id: number;
  name: string;
  status: string;
  date: string;
}

interface TrackRecordData {
  stats: {
    proposed: number;
    passed: number;
    conversionRate: string;
  };
  bills: Bill[];
  error?: string;
}

export default function TrackRecordPOC() {
  const [selectedMk, setSelectedMk] = useState(SAMPLE_MKS[0].id);
  const [data, setData] = useState<TrackRecordData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTrackRecord() {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await fetch(`/knesset-watch/api/track-record?personId=${selectedMk}`);
        const json = await res.json();
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
        }
      } catch (err) {
        console.error(err);
        setError('שגיאת תקשורת - נסו שנית בעוד רגע');
      } finally {
        setLoading(false);
      }
    }
    fetchTrackRecord();
  }, [selectedMk]);

  return (
    <div className="min-h-screen bg-white text-black p-8 font-[family-name:var(--font-frank-ruhl)]" dir="rtl">
      <header className="mb-12 border-b-4 border-black pb-4">
        <h1 className="text-4xl font-black">POC: הוכחת פעילות חקיקה (Track Record)</h1>
      </header>

      <div className="mb-8 flex items-center gap-4 bg-gray-50 p-4 rounded-lg">
        <span className="font-bold">בחר חבר כנסת:</span>
        <select 
          value={selectedMk} 
          onChange={(e) => setSelectedMk(Number(e.target.value))}
          className="border-2 border-black p-2 bg-white font-bold"
        >
          {SAMPLE_MKS.map(mk => (
            <option key={mk.id} value={mk.id}>{mk.name}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="text-2xl font-bold animate-pulse py-10">טוען נתונים מהכנסת...</div>
      )}

      {error && (
        <div className="bg-red-50 border-2 border-red-600 p-6 text-red-600 font-bold mb-10">
          שגיאה: {error}
          <button 
            onClick={() => window.location.reload()}
            className="mr-4 underline"
          >
            נסו לרענן
          </button>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-12">
          {/* Dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="border-4 border-black p-6">
              <div className="text-sm font-bold uppercase text-gray-500 mb-2">הצעות חוק שהוגשו</div>
              <div className="text-6xl font-black">{data.stats.proposed}</div>
            </div>
            <div className="border-4 border-black p-6 bg-black text-white shadow-xl">
              <div className="text-sm font-bold uppercase text-gray-400 mb-2">חוקים שעברו סופית</div>
              <div className="text-6xl font-black">{data.stats.passed}</div>
            </div>
            <div className="border-4 border-black p-6">
              <div className="text-sm font-bold uppercase text-gray-500 mb-2">אחוז הצלחה (Conversion)</div>
              <div className="text-6xl font-black">{data.stats.conversionRate}%</div>
            </div>
          </div>

          {/* Table */}
          <div>
            <h2 className="text-2xl font-black mb-4 border-b-2 border-black inline-block">פירוט הצעות חוק</h2>
            <div className="overflow-x-auto border-2 border-black/5">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b-2 border-black bg-gray-50">
                    <th className="py-3 px-4 font-black">שם החוק</th>
                    <th className="py-3 px-4 font-black">סטטוס</th>
                    <th className="py-3 px-4 font-black text-left">עדכון אחרון</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bills.map((bill: Bill) => (
                    <tr key={bill.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-4 px-4 font-medium leading-tight max-w-md">{bill.name}</td>
                      <td className="py-4 px-4">
                        <span className={`px-2 py-1 text-xs font-bold rounded ${
                          bill.status.includes('סופי') || bill.status.includes('אישור') ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {bill.status}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-left font-mono text-sm text-gray-400">
                        {new Date(bill.date).toLocaleDateString('he-IL')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
