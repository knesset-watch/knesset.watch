import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');
const PASSED_STATUS_IDS = new Set([118, 119, 6020, 6030, 6040]);

async function fetchPage(url: string): Promise<{ value: any[]; next: string | null }> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Knesset API ${res.status}`);
  const json = await res.json();
  return { value: json.value ?? [], next: json['@odata.nextLink'] ?? null };
}

async function fetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    const page = await fetchPage(next);
    results.push(...page.value);
    next = page.next;
    if (results.length % 500 === 0) process.stdout.write(`  ${results.length.toLocaleString()} fetched`);
  }
  return results;
}

function categorize(title: string, committee: string | null): { macro: string; micro: string } {
  const t = title.toLowerCase();
  const c = committee || '';
  let macro = "מנהל ומשפט";
  if (c.includes("ביטחון") || t.includes('צה"ל') || t.includes("צבא") || t.includes("טרור") || t.includes("נשק") || t.includes("מילואים") || t.includes("חיילים")) macro = "ביטחון וצבא";
  else if (c.includes("כספים") || c.includes("כלכלה") || t.includes("מס ") || t.includes("מיסוי") || t.includes("תקציב") || t.includes("צרכן") || t.includes("בנק") || t.includes("מכס")) macro = "כלכלה ויוקר המחיה";
  else if (c.includes("בריאות") || c.includes("רווחה") || t.includes("בריאות") || t.includes("ביטוח לאומי") || t.includes("קצבת") || t.includes("נכים") || t.includes("עוני")) macro = "בריאות ורווחה";
  else if (c.includes("חינוך") || t.includes("חינוך") || t.includes("בתי ספר") || t.includes("תלמידים") || t.includes("אקדמיה") || t.includes("תרבות") || t.includes("ספורט")) macro = "חינוך ותרבות";
  else if (t.includes("רבנות") || t.includes("דת") || t.includes("כשרות") || t.includes("שבת") || t.includes("גיור") || t.includes("בתי דין רבניים")) macro = "דת ומדינה";
  else if (c.includes("חוקה") || c.includes("משפט") || t.includes("עונשין") || t.includes("פשיעה") || t.includes("אלימות") || t.includes("בתי משפט") || t.includes("שפיטה") || t.includes("מאסר")) macro = "משפט ופשיעה";
  else if (c.includes("סביבה") || t.includes("תכנון והבניה") || t.includes("תחבורה") || t.includes("מקרקעין") || t.includes("אנרגיה") || t.includes("מים") || t.includes("חשמל")) macro = "סביבה ותשתיות";
  else if (c.includes("עבודה") || t.includes("עובדים") || t.includes("שכר") || t.includes("תעסוקה") || t.includes("חופשה") || t.includes("פיצויי פיטורים")) macro = "עבודה ותעסוקה";
  else if (c.includes("פנים") || t.includes("רשויות מקומיות") || t.includes("בחירות") || t.includes("ממשלה") || t.includes("כנסת") || t.includes("שירות המדינה") || t.includes("מבקר המדינה")) macro = "שלטון ומינהל";
  else if (c.includes("זכויות") || c.includes("נשים") || t.includes("הפליה") || t.includes("שוויון") || t.includes('להט"ב')) macro = "זכויות אדם ושוויון";

  let micro = title.replace(/^הצעת /, '').replace(/, התשפ.*/, '').replace(/ \S+$/, '');
  const parenMatch = title.match(/\(([^0-9(]+)\)/);
  if (parenMatch && parenMatch[1] && parenMatch[1].length > 5 && !parenMatch[1].includes("תיקון")) {
    micro = parenMatch[1];
  } else {
    micro = micro.replace(/^חוק /, '').replace(/^לתיקון פקודת /, 'פקודת ').replace(/ \(תיקון מס' \d+\)/, '').replace(/ \(תיקון\)/, '').trim();
    if (micro.length > 50) micro = micro.substring(0, 47) + "...";
  }
  return { macro, micro };
}

async function rebuild() {
  const db = new Database(DB_PATH);
  
  const billCols = (db.prepare(`PRAGMA table_info(bill)`).all() as { name: string }[]).map(r => r.name);
  if (!billCols.includes('status_desc')) db.exec(`ALTER TABLE bill ADD COLUMN status_desc TEXT`);

  console.log('Fetching all K25 bills to restore data...');
  const bills = await fetchAll(`${API}/KNS_Bill?$filter=KnessetNum eq 25&$expand=KNS_Status($select=Desc)&$select=Id,Name,SubTypeDesc,StatusID,CommitteeID,SummaryLaw,PublicationDate`);
  
  const committeeRows = await fetchAll(`${API}/KNS_Committee?$select=Id,Name`);
  const committeeMap = new Map<number, string>();
  for (const r of committeeRows) { if (r.Id != null && r.Name) committeeMap.set(r.Id, r.Name); }

  const updateBill = db.prepare(`
    UPDATE bill SET 
      title = ?, subtype = ?, status_id = ?, status_desc = ?, is_passed = ?, 
      committee_id = ?, committee_name = ?, summary = ?, 
      micro_agenda = ?, macro_agenda = ?, publication_date = ?
    WHERE id = ?
  `);

  db.transaction((rows: any[]) => {
    for (const r of rows) {
      const committeeName = r.CommitteeID != null ? (committeeMap.get(r.CommitteeID) ?? null) : null;
      const { macro, micro } = categorize(r.Name ?? '', committeeName);
      updateBill.run(
        r.Name ?? '', r.SubTypeDesc ?? '', r.StatusID ?? 0,
        r.KNS_Status?.Desc ?? null,
        PASSED_STATUS_IDS.has(r.StatusID) ? 1 : 0,
        r.CommitteeID ?? null, committeeName,
        r.SummaryLaw?.trim() ?? null,
        micro, macro, r.PublicationDate ?? null,
        r.Id
      );
    }
  })(bills);

  db.close();
  console.log(`
Restored ${bills.length} bills.`);
}

rebuild().catch(console.error);