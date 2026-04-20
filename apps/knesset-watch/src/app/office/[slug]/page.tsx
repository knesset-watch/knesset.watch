import { Metadata } from 'next';
import { getOfficeDetail, getOfficeActivityJournal } from '@/lib/knesset-db';
import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import OfficeClient from './OfficeClient';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const office = getOfficeDetail(slug);

  return {
    title: office ? `${office.displayName} - משרד` : 'משרד',
    description: office ? `תיאור קו זמן של משרד ${office.displayName}` : 'משרד',
  };
}

export default async function OfficePage({ params }: PageProps) {
  const authenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!authenticated) redirect('/login');

  const { slug } = await params;
  const office = getOfficeDetail(slug);

  if (!office) {
    redirect('/ministers');
  }

  const activityJournal = getOfficeActivityJournal(office.id);

  return <OfficeClient office={office} activityJournal={activityJournal} />;
}
