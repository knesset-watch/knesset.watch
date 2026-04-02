// Shared vote result utilities used across multiple pages.

export const VOTE_RESULT_COLORS: Record<string, string> = {
  'בעד':  'bg-[#16A34A] text-white',
  'נגד':  'bg-red-100 text-red-700',
  'נמנע': 'bg-amber-100 text-amber-800',
  'נוכח': 'bg-zinc-100 text-zinc-500',
};

export const CODE_TO_LABEL: Record<number, string> = {
  6: 'נוכח',
  7: 'בעד',
  8: 'נגד',
  9: 'נמנע',
};
