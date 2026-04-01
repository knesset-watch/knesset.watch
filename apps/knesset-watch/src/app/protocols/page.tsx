import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import { getProtocolCommitteeNames, type CommitteeOption } from '@/lib/protocols-db';
import ProtocolsClient from './ProtocolsClient';

export default async function ProtocolsPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const committees = await getProtocolCommitteeNames();

  return <ProtocolsClient committees={committees} />;
}
