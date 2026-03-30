import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import { getMinisters } from '@/lib/knesset-db';
import MinistersClient from './MinistersClient';

export default async function MinistersPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const ministers = getMinisters();
  return <MinistersClient ministers={ministers} />;
}
