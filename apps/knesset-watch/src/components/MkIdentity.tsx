'use client';

import { useState } from 'react';

/**
 * זהות חבר כנסת: תמונה, רקע תעסוקתי, רקע אקדמי וותק.
 *
 * משותף לכרטיסיות ב-/mks ולתוצאות ב-/agenda-match, כדי שח"כ ייראה
 * אותו דבר בכל מקום באתר.
 *
 * הנתונים מגיעים מ-lib/mk-profiles ומקורם ב-Wikidata. 140 מתוך 147
 * ח"כים מכוסים; מי שאין לו תמונה מקבל ראשי תיבות, ומי שאין לו רקע
 * פשוט לא מציג את השורה — בלי מקום ריק.
 */

export interface MkIdentityData {
  name: string;
  photo?: string | null;
  /** "עיתונאי · מנחה טלוויזיה" */
  occupation?: string | null;
  /** "האוניברסיטה העברית בירושלים" */
  education?: string | null;
  /** "מכהן מאז 1988 · 38 שנים" */
  tenure?: string | null;
  isCoalition?: boolean | null;
}

type Size = 'sm' | 'lg';

const AVATAR: Record<Size, string> = {
  sm: 'w-12 h-12 text-sm',
  lg: 'w-16 h-16 text-lg',
};

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('');
}

/**
 * תמונה כשיש, אחרת ראשי תיבות. הטבעת מבחינה בין קואליציה לאופוזיציה
 * באותם צבעים שבשאר האתר.
 *
 * object-top ולא object-center: בתמונות דיוקן הפנים בשליש העליון,
 * ומרכוז חותך אותן.
 */
export function MkAvatar({
  name,
  photo,
  isCoalition,
  size = 'sm',
}: {
  name: string;
  photo?: string | null;
  isCoalition?: boolean | null;
  size?: Size;
}) {
  const [failed, setFailed] = useState(false);

  const ring =
    isCoalition === true ? 'ring-green-600/30'
    : isCoalition === false ? 'ring-blue-600/30'
    : 'ring-black/10';

  const fill =
    isCoalition === true ? 'bg-green-600'
    : isCoalition === false ? 'bg-blue-600'
    : 'bg-gray-400';

  if (photo && !failed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={photo}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${AVATAR[size]} rounded-full object-cover object-top shrink-0 ring-2 ${ring} bg-gray-100`}
      />
    );
  }

  return (
    <div
      className={`${AVATAR[size]} rounded-full shrink-0 ring-2 ${ring} ${fill} flex items-center justify-center font-black text-white`}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

/**
 * שורות הרקע בלבד, בלי התמונה ובלי השם — כדי שכל מסך יוכל להרכיב
 * את הפריסה שלו סביבן.
 */
export function MkBackground({
  occupation,
  education,
  tenure,
  className = '',
}: {
  occupation?: string | null;
  education?: string | null;
  tenure?: string | null;
  className?: string;
}) {
  if (!occupation && !education && !tenure) return null;

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {occupation && (
        <p className="text-xs text-gray-600 font-medium truncate" title={occupation}>
          {occupation}
        </p>
      )}
      {education && (
        <p className="text-xs text-gray-400 font-medium truncate" title={education}>
          {education}
        </p>
      )}
      {tenure && (
        <p className="text-[11px] text-gray-400 font-black tabular-nums">{tenure}</p>
      )}
    </div>
  );
}
