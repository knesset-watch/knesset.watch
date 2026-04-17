export const GLOSSARY = {
  committees: {
    he: 'ועדות',
    label: 'Committees',
    definition: 'Specialized subgroups of parliament where detailed legislative work and debates occur before bills are brought to the full parliament for voting.'
  },
  coalition: {
    he: 'קואליציה',
    label: 'Coalition',
    definition: 'Political parties that together have enough seats to form a majority government. They typically support each other on key legislative votes.'
  },
  opposition: {
    he: 'אופוזיציה',
    label: 'Opposition',
    definition: 'Political parties that are not part of the government coalition. They typically propose alternative legislation and scrutinize government actions.'
  },
  fingerprint: {
    he: 'טביעת אצבע פרלמנטרית',
    label: 'Parliamentary Fingerprint',
    definition: 'A visualization showing which policy areas (agendas) an MK focuses on most based on their voting and legislative activity.'
  },
  bills: {
    he: 'הצעות חוק',
    label: 'Bills / Proposed Legislation',
    definition: 'Draft laws proposed by MKs or the government that undergo committee review and parliamentary votes before becoming law.'
  },
  passed: {
    he: 'עברו',
    label: 'Passed / Approved',
    definition: 'Bills that received majority support in a parliamentary vote and became law.'
  },
  inProgress: {
    he: 'בתהליך',
    label: 'In Progress',
    definition: 'Bills that are still in committee review or awaiting parliamentary vote, not yet finalized.'
  },
  attendance: {
    he: 'נוכחות',
    label: 'Attendance / Present',
    definition: 'An MK was present during voting but chose not to vote for or against a bill.'
  },
  abstain: {
    he: 'נמנע',
    label: 'Abstain',
    definition: 'An MK was present but abstained from voting (neither voted for nor against).'
  },
  absent: {
    he: 'היעדרות',
    label: 'Absent',
    definition: 'An MK was not present during a vote. This may be due to other parliamentary duties, illness, or pair agreement.'
  },
  protocols: {
    he: 'פרוטוקולים',
    label: 'Session Protocols',
    definition: 'Official transcripts of what was said and discussed during committee or parliament sessions.'
  },
  activeMembers: {
    he: 'חברי כנסת פעילים',
    label: 'Active Members',
    definition: 'MKs who are currently seated in parliament. Some former members may also be shown for historical context.'
  }
};

export function getGlossaryEntry(key: keyof typeof GLOSSARY) {
  return GLOSSARY[key];
}
