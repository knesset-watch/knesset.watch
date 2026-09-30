import { Suspense } from 'react';
import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import HeigdimClient from './HeigdimClient';

/**
 * גרסת היגדים של השאלון, לבדיקה.
 *
 * קיימת לצד /agenda-keywords ולא במקומה, באותו היגיון שבו agenda-keywords
 * נבנה לצד agenda-match: אפשר לשלוח לבודקות את שני הקישורים ולהשוות לפני
 * שמחליטים איזה נשאר. אם הפורמט נפסל, מוחקים את התיקייה ואין מה לפרק.
 */
export default async function AgendaHeigdimPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) {
    redirect('/login');
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" dir="rtl" />}>
      <HeigdimClient />
    </Suspense>
  );
}
