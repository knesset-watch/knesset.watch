#!/usr/bin/env node
/**
 * Check Knesset API for all K25 positions (not just current ones)
 * to find who should be included but isn't marked as IsCurrent
 */

const fs = require('fs');

const KNESSET_API = 'https://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_PersonToPosition';

async function fetchPositions() {
  console.log('Fetching all K25 positions from Knesset API...\n');

  try {
    const response = await fetch(`${KNESSET_API}?$filter=KnesketNum eq 25&$top=500`);
    const data = await response.json();

    // Group by person and collect ministry positions
    const ministryPositions = {};
    const allPositions = data.value || [];

    console.log(`API returned ${allPositions.length} total positions\n`);

    allPositions
      .filter(p => p.PositionID === 25 || p.PositionID === 26 || p.PositionID === 27) // Minister positions
      .forEach(p => {
        if (!ministryPositions[p.PersonID]) {
          ministryPositions[p.PersonID] = [];
        }
        ministryPositions[p.PersonID].push({
          name: p.PersonName,
          position: p.PositionTitle,
          isCurrent: p.IsCurrent,
          startDate: p.StartDate,
          endDate: p.EndDate
        });
      });

    const currentMinisterIds = new Set();
    const notCurrentMinisterIds = new Set();

    Object.entries(ministryPositions).forEach(([personId, positions]) => {
      const hasCurrent = positions.some(p => p.isCurrent);
      if (hasCurrent) currentMinisterIds.add(personId);
      else notCurrentMinisterIds.add(personId);
    });

    console.log(`═══════════════════════════════════════════════════════════════`);
    console.log(`CURRENT MINISTERS (IsCurrent=1): ${currentMinisterIds.size}\n`);

    Array.from(currentMinisterIds)
      .sort()
      .slice(0, 30)
      .forEach(id => {
        const name = ministryPositions[id][0].name;
        const positions = ministryPositions[id].map(p => p.position).join(', ');
        console.log(`  ${name}: ${positions}`);
      });

    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`NON-CURRENT MINISTERS: ${notCurrentMinisterIds.size}\n`);

    Array.from(notCurrentMinisterIds)
      .sort()
      .slice(0, 10)
      .forEach(id => {
        const name = ministryPositions[id][0].name;
        const positions = ministryPositions[id]
          .filter(p => !p.isCurrent)
          .map(p => `${p.position} (${p.startDate} - ${p.endDate})`)
          .join(', ');
        console.log(`  ${name}: ${positions}`);
      });

  } catch (err) {
    console.error('Error:', err.message);
  }
}

fetchPositions();
