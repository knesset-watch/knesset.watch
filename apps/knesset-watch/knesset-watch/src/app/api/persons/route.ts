import { NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

const KNESSET_ORIGIN = 'https://knesset.gov.il';
const PROXY_BASE = (process.env.KNESSET_PROXY_URL ?? KNESSET_ORIGIN) + '/OdataV4/ParliamentInfo';

async function fetchKnessetAll(path: string) {
  let url: string | null = `${PROXY_BASE}/${path}`;
  let allData: any[] = [];

  while (url) {
    const res: Response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Knesset API error ${res.status}: ${path}`);
    const data = await res.json();
    allData = allData.concat(data.value || []);
    const nextLink: string | undefined = data['@odata.nextLink'];
    url = nextLink ? nextLink.replace(KNESSET_ORIGIN, process.env.KNESSET_PROXY_URL ?? KNESSET_ORIGIN) : null;
    if (allData.length > 1000) break;
  }
  return { value: allData };
}

/** Generate a URL-safe English slug (fallback logic for non-K25) */
function mkSlugLegacy(person: any): string {
  const first = (person.FirstNameEng ?? '').trim();
  const last  = (person.LastNameEng  ?? '').trim();
  if (first || last) {
    return `${first}-${last}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
  }
  return String(person.Id);
}

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const isCurrent = searchParams.get('isCurrent') === 'true';
  const knessetNumParam = searchParams.get('knessetNum');
  const knessetNum = knessetNumParam ? parseInt(knessetNumParam) : null;

  try {
    // ── Fast path: local SQLite DB for K25 ──────────────────────────────────
    if (dbAvailable() && (!knessetNum || knessetNum === 25)) {
      const db = new Database(DB_PATH, { readonly: true });
      const rows = db.prepare(`
        SELECT
          person_id as Id,
          first_name as FirstName,
          last_name as LastName,
          faction_name as FactionName,
          slug,
          is_current as IsCurrent,
          is_coalition as IsCoalition,
          coalition_pct as coalitionPct,
          non_mk_pct as nonMkPct,
          segments,
          (SELECT duty_desc FROM mk_position
           WHERE mk_id = person_id AND is_current = 1
           AND (duty_desc LIKE 'שר %' OR duty_desc LIKE 'שרת %'
             OR duty_desc LIKE 'השר %' OR duty_desc LIKE 'השרה %'
             OR duty_desc LIKE 'סגן שר%' OR duty_desc LIKE 'סגנית שר%')
           ORDER BY
             CASE WHEN duty_desc LIKE 'סגן%' OR duty_desc LIKE 'סגנית%' THEN 1 ELSE 0 END
           LIMIT 1) as ministerRole
        FROM mk_person
      `).all() as any[];
      db.close();

      const people = rows.map(r => ({
        ...r,
        IsCurrent: !!r.IsCurrent,
        IsCoalition: r.IsCoalition === null ? null : !!r.IsCoalition,
        segments: r.segments ? JSON.parse(r.segments) : [],
      }));

      return NextResponse.json({ value: people, source: 'db' });
    }

    // ── Fallback path: live Knesset API for non-K25 ─────────────────────────
    if (knessetNum && knessetNum !== 25) {
      const [posJson, factionsJson] = await Promise.all([
        fetchKnessetAll(`KNS_PersonToPosition?$filter=PositionID eq 54 and KnessetNum eq ${knessetNum}&$expand=KNS_Person`),
        fetchKnessetAll(`KNS_Faction?$filter=KnessetNum eq ${knessetNum}`).catch(() => ({ value: [] })),
      ]);

      const factionNameMap = new Map<number, string>();
      for (const f of factionsJson.value) {
        const id = f.FactionID ?? f.Id;
        if (id != null && f.Name) factionNameMap.set(id, f.Name);
      }

      const latest = new Map<number, any>();
      for (const item of posJson.value) {
        if (!item.KNS_Person) continue;
        const pid: number = item.KNS_Person.Id;
        const prev = latest.get(pid);
        if (!prev || new Date(item.StartDate) > new Date(prev.StartDate)) latest.set(pid, item);
      }

      const people = Array.from(latest.values()).map(item => ({
        Id: item.KNS_Person.Id,
        FirstName: item.KNS_Person.FirstName,
        LastName: item.KNS_Person.LastName,
        slug: mkSlugLegacy(item.KNS_Person),
        IsCurrent: false,
        FactionName: item.FactionID != null ? (factionNameMap.get(item.FactionID) ?? null) : null,
        IsCoalition: null,
        coalitionPct: null,
        nonMkPct: 0,
        segments: [],
      }));

      return NextResponse.json({ value: people, source: 'api' });
    }

    return NextResponse.json({ value: [] });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
