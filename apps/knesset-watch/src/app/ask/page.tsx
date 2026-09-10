import { checkServerAuth } from '@/lib/ui/auth-utils';
import { aiFeaturesEnabled } from '@/lib/feature-flags';
import { redirect } from 'next/navigation';
import AskClient from './AskClient';

export const dynamic = 'force-dynamic';

export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');
  if (!aiFeaturesEnabled()) redirect('/');

  const { q } = await searchParams;
  return <AskClient initialQ={q ?? ''} />;
}
