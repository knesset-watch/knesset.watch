import { Suspense } from 'react';
import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import AgendaMatchClient from './AgendaMatchClient';

export default async function AgendaMatchPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) {
    redirect('/login');
  }

  // useSearchParams קורא את ?domains= שמגיע ממסך הבית, ולכן חייב גבול Suspense
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" dir="rtl" />}>
      <AgendaMatchClient />
    </Suspense>
  );
}
