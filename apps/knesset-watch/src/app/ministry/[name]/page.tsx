import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect, notFound } from 'next/navigation';
import { getMinistryDetail } from '@/lib/knesset-db';
import MinistryClient from './MinistryClient';

interface Props {
  params: Promise<{ name: string }>;
}

export default async function MinistryPage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);

  const data = getMinistryDetail(name);
  if (!data) notFound();

  return <MinistryClient data={data} />;
}
