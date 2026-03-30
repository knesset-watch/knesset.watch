import { checkServerAuth } from '@minimal-db/ui/auth-utils';
import { redirect } from 'next/navigation';
import VoteDetailClient from './VoteDetailClient';

interface Props {
  params: Promise<{ voteId: string }>;
}

export default async function VotePage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) {
    redirect('/login');
  }

  const { voteId } = await params;
  return <VoteDetailClient voteId={voteId} />;
}
