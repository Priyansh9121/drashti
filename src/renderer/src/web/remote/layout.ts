import { useEffect, useState } from 'react';

/*
 * How the remote is laid out (Session 18): tabs on a phone; on a tablet held upright (or a narrow window), the
 * playlist or the library beside the show; held sideways (or a wide window), the live picture, the notes and Next
 * beside the slides. A phone held sideways (844 × 390, say) is as wide as a small tablet but far too short for its
 * columns, Back and Next and a header: it keeps a phone's tabs (Session 54, D5 review; until then it took the
 * upright tablet's columns, its middle a sliver), with Back, Next and the tabs at its side instead of under the middle
 * (alpha.21, the fit pass: under it they left a middle about 150 px high, too short for the live picture).
 */

export type RemoteLayout = 'phone' | 'sideways' | 'wide' | 'landscape';

export const WIDE = '(min-width: 768px)';
export const LANDSCAPE = '(min-width: 1000px) and (orientation: landscape)';
/** A window this short is a phone held sideways (the shortest tablet is 744 CSS pixels each way). */
export const SHORT = '(max-height: 500px)';

/** The layout for the page's media queries as they answer now. */
export function layoutFor(matches: (query: string) => boolean): RemoteLayout {
  if (matches(SHORT)) return 'sideways';
  return matches(LANDSCAPE) ? 'landscape' : matches(WIDE) ? 'wide' : 'phone';
}

/** The layout now, again as the window changes size or is turned. */
export function useLayout(): RemoteLayout {
  const read = (): RemoteLayout => layoutFor((query) => matchMedia(query).matches);
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const queries = [LANDSCAPE, WIDE, SHORT].map((q) => matchMedia(q));
    const on = () => {
      setLayout(read());
    };
    for (const q of queries) q.addEventListener('change', on);
    return () => {
      for (const q of queries) q.removeEventListener('change', on);
    };
  }, []);
  return layout;
}
