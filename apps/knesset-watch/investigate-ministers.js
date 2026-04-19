/**
 * Investigate missing ministers by querying Knesset API directly
 */

async function fetchAll(url) {
  const results = [];
  let next = url;
  while (next) {
    const res = await fetch(next, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const json = await res.json();
    results.push(...(json.value ?? []));
    next = json['@odata.nextLink'] ?? null;
  }
  return results;
}

(async () => {
  const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
  
  console.log('📊 INVESTIGATING KNESSET API DATA\n');
  
  // Fetch all K25 positions from API WITH person details
  console.log('Fetching all K25 positions from Knesset API...');
  const positions = await fetchAll(
    `${API}/KNS_PersonToPosition?$filter=KnessetNum eq 25&$expand=KNS_Person($select=FirstName,LastName)&$select=Id,PersonID,DutyDesc,GovMinistryID,GovMinistryName,StartDate,FinishDate,IsCurrent`
  );
  
  // Filter to ministry positions only
  const ministryPositions = positions.filter(p => p.GovMinistryID != null);
  
  console.log(`Total positions in API: ${positions.length}`);
  console.log(`Ministry positions (GovMinistryID IS NOT NULL): ${ministryPositions.length}`);
  
  // Current positions
  const currentPositions = ministryPositions.filter(p => p.IsCurrent);
  console.log(`Current ministry positions (IsCurrent=1): ${currentPositions.length}`);
  
  // Distinct persons with current ministry positions
  const currentMinisterIds = new Set(currentPositions.map(p => p.PersonID));
  console.log(`Distinct current ministers: ${currentMinisterIds.size}`);
  
  console.log('\n📋 CURRENT MINISTERS IN API:\n');
  
  // Group by person and show details
  const ministersByPerson = {};
  for (const pos of currentPositions) {
    const name = pos.KNS_Person 
      ? `${pos.KNS_Person.FirstName} ${pos.KNS_Person.LastName}`.trim()
      : `Unknown (ID ${pos.PersonID})`;
    if (!ministersByPerson[pos.PersonID]) {
      ministersByPerson[pos.PersonID] = { name, positions: [] };
    }
    ministersByPerson[pos.PersonID].positions.push(pos.GovMinistryName);
  }
  
  const ministers = Object.entries(ministersByPerson)
    .map(([id, data]) => ({ id: parseInt(id), ...data }))
    .sort((a, b) => a.name.localeCompare(b.name));
  
  ministers.forEach((m, i) => {
    console.log(`${i + 1}. ${m.name} (ID: ${m.id})`);
    m.positions.forEach(pos => console.log(`   → ${pos}`));
  });
  
  // Check for recent non-current positions
  console.log('\n⚠️  RECENT NON-CURRENT MINISTRY POSITIONS (< 4 months):\n');
  
  const now = new Date();
  const recentNonCurrent = ministryPositions
    .filter(p => !p.IsCurrent && p.StartDate)
    .filter(p => {
      const start = new Date(p.StartDate);
      const daysSince = (now - start) / (1000 * 60 * 60 * 24);
      return daysSince < 120; // Last 4 months
    })
    .map(p => ({
      personId: p.PersonID,
      name: p.KNS_Person ? `${p.KNS_Person.FirstName} ${p.KNS_Person.LastName}`.trim() : 'Unknown',
      ministry: p.GovMinistryName,
      startDate: p.StartDate.split('T')[0],
      finishDate: p.FinishDate ? p.FinishDate.split('T')[0] : 'ongoing'
    }))
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
  
  if (recentNonCurrent.length > 0) {
    recentNonCurrent.slice(0, 10).forEach(p => {
      console.log(`${p.name} → ${p.ministry}`);
      console.log(`  ${p.startDate} to ${p.finishDate}`);
    });
  } else {
    console.log('None found');
  }
  
  // Summary
  console.log('\n\n📈 SUMMARY:\n');
  console.log(`Government 37 baseline: 33 (28 ministers + 5 deputies)`);
  console.log(`API current ministers: ${ministers.length}`);
  console.log(`API current position records: ${currentPositions.length}`);
  console.log(`Gap: ${33 - ministers.length} ministers`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
