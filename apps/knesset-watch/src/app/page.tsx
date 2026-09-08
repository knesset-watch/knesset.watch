import { checkServerAuth } from '@/lib/ui/auth-utils';
import { aiFeaturesEnabled } from '@/lib/feature-flags';
import { redirect } from 'next/navigation';
import HomepageClient from './HomepageClient';

export default async function Page() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) {
    redirect('/login');
  }

  return <HomepageClient aiEnabled={aiFeaturesEnabled()} />;
}
