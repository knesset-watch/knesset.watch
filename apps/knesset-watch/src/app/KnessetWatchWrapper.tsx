'use client';

import dynamic from 'next/dynamic';

const KnessetWatchPage = dynamic(() => import('./KnessetWatchClient'), { ssr: false });

export default function KnessetWatchWrapper() {
  return <KnessetWatchPage />;
}
