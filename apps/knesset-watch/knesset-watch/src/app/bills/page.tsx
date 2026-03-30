import { checkServerAuth } from '@minimal-db/ui/auth-utils';
import { redirect } from 'next/navigation';
import BillsClient from './BillsClient';

export default async function BillsPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');
  return <BillsClient />;
}
