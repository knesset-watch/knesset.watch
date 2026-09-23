// Shared vote result utilities used across multiple pages.

export const VOTE_RESULT_COLORS: Record<string, string> = {
  'בעד':  'bg-pass text-white',
  'נגד':  'bg-fail-wash text-fail',
  'נמנע': 'bg-warn-wash text-warn',
  'נוכח': 'bg-surface-2 text-mute',
};

export const CODE_TO_LABEL: Record<number, string> = {
  6: 'נוכח',
  7: 'בעד',
  8: 'נגד',
  9: 'נמנע',
};
