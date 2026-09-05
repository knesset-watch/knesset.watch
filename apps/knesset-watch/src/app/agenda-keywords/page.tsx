import { Suspense } from 'react';
import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import KeywordMatchClient from './KeywordMatchClient';

/**
 * מסלול חלופי לשאלון: ענן מילות מפתח במקום משפך תחומים.
 *
 * קיים לצד /agenda-match ולא במקומו, כדי שאפשר יהיה להשוות בין השניים
 * לפני שמחליטים איזה נשאר.
 */
export default async function AgendaKeywordsPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) {
    redirect('/login');
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-white" dir="rtl" />}>
      <KeywordMatchClient />
    </Suspense>
  );
}
