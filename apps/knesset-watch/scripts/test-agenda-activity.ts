import { computeAgendaActivity } from '../src/lib/agenda-activity';

const res = computeAgendaActivity([
  { issueId: 'haredi-draft', stanceId: 'support-draft' },
  { issueId: 'judicial-reform', stanceId: 'support-reform' },
]);

console.log('=== COVERAGE ===');
for (const c of res.coverage) {
  console.log(`  ${c.label.padEnd(18)} bills:${String(c.billCount).padStart(4)} votes:${String(c.voteCount).padStart(4)} active:${String(c.activeMks).padStart(4)} src:${c.source}${c.belowThreshold ? '  ⚠ BELOW THRESHOLD' : ''}`);
}
console.log(`\n=== TOP 10 of ${res.rows.length} ranked ===`);
res.rows.slice(0, 10).forEach((r, i) => {
  const flags = r.perAgenda.reduce((s, a) => s + a.flags.rebelVotes, 0);
  console.log(
    `${String(i + 1).padStart(2)}. ${String(r.overallScore).padStart(5)} | ${r.name.padEnd(20)} | ${(r.faction ?? '').padEnd(16)}` +
    `${r.isMinister ? ' [שר]' : ''}${flags ? ` [מרד ${flags}]` : ''}`,
  );
  for (const a of r.perAgenda) {
    console.log(`         ${a.label}: ${a.score} (חוקים ${a.billsInitiated}/P${a.pInitiative} · תמיכה ${a.supportingVotes}/${a.voteOpportunities}/P${a.pVoting})`);
  }
});
