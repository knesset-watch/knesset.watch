/**
 * MK nickname / alias map.
 * Keys: the nickname as it might appear in a search query.
 * Values: the full name as stored in mk_person (first_name + ' ' + last_name).
 *
 * This covers cases that the last-name-only fallback in findMkInText() can't handle:
 * - Genuine nicknames that don't match any part of the official name (ביבי → נתניהו)
 * - Compound surnames with spaces (בן גביר) that need explicit mapping
 * - Common informal short-forms used by journalists and the public
 */
export const MK_NICKNAMES: Record<string, string> = {
  // Genuine nicknames (not derivable from name parts)
  'ביבי': 'בנימין נתניהו',

  // Compound surnames (space inside — harder for word-boundary regex)
  'בן גביר': 'איתמר בן גביר',
};
