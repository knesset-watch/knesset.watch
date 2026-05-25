import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect } from 'next/navigation';
import { resolveMinistrySlug } from '@/lib/knesset-db';

interface Props {
  params: Promise<{ name: string }>;
}

export default async function MinistryPage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);

  // Resolve ministry name to canonical office slug
  const slug = resolveMinistrySlug(name);
  if (!slug) redirect('/ministers');

  // Redirect to the canonical office page
  redirect(`/office/${slug}`);
}
