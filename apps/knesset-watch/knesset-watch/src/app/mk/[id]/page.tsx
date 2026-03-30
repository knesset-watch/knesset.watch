import { checkServerAuth } from '@minimal-db/ui/auth-utils';
import { redirect, notFound } from 'next/navigation';
import MKProfileClient from './MKProfileClient';

interface Props {
  params: Promise<{ id: string }>;
}

const KNESSET_API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';

function toSlug(person: any): string {
  const first = (person.FirstNameEng ?? '').trim();
  const last  = (person.LastNameEng  ?? '').trim();
  if (first || last) {
    return `${first}-${last}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
  }
  return String(person.Id);
}

/**
 * Resolve an English name slug (e.g. "naama-lazimi") to a PersonID.
 * Response cached for 1 hour by Next.js fetch cache.
 */
async function resolveSlugToPersonId(slug: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${KNESSET_API}/KNS_PersonToPosition` +
      `?$filter=KnessetNum eq 25 and PositionID eq 54` +
      `&$expand=KNS_Person($select=Id,FirstNameEng,LastNameEng)` +
      `&$select=PersonID`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();

    for (const row of data.value ?? []) {
      const p = row.KNS_Person;
      if (!p) continue;
      if (toSlug(p) === slug) return p.Id;
    }
    return null;
  } catch {
    return null;
  }
}

export default async function MKPage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) {
    redirect('/login');
  }

  const { id: rawParam } = await params;
  const param = decodeURIComponent(rawParam);

  let mkId: string;

  if (/^\d+$/.test(param)) {
    mkId = param;
  } else if (/^[a-z0-9-]+$/.test(param)) {
    const personId = await resolveSlugToPersonId(param);
    if (!personId) notFound();
    mkId = String(personId);
  } else {
    notFound();
  }

  return <MKProfileClient mkId={mkId} />;
}
