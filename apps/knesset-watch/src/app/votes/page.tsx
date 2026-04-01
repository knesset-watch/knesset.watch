import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import VotesClient from './VotesClient';

export const dynamic = 'force-dynamic';

export default async function VotesPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  return <VotesClient />;
}
