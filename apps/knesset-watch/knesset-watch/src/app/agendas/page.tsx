import { checkServerAuth } from '@minimal-db/ui/auth-utils';
import { redirect } from 'next/navigation';
import AgendasClient from './AgendasClient';

export default async function AgendasPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) {
    redirect('/login');
  }

  return <AgendasClient />;
}
