import { useEffect } from 'react';
import { create } from 'zustand';
import { isPassageId } from '../../../shared/shastra';

/*
 * A Shastra passage's reference ("Placeholder Granth 14–16"), for the header
 * and anything else that names what is live: passages are not in the
 * library's list, so each one's reference is asked for once, and asked again
 * after a text is loaded or removed (its name may have changed).
 */

const usePassageNames = create<Record<string, string | null>>(() => ({}));
const asked = new Set<string>();
let watching = false;

function watch(): void {
  if (watching) return;
  watching = true;
  window.drashti.library.onChanged((what) => {
    if (what !== 'shastra') return;
    asked.clear();
    usePassageNames.setState({}, true);
  });
}

/** A passage's reference, once known; null for anything else (or a passage of a text no longer loaded). */
export function usePassageName(id: string | null | undefined): string | null {
  const known = usePassageNames((s) => (id ? s[id] : undefined));
  useEffect(() => {
    if (!id || !isPassageId(id) || asked.has(id)) return;
    watch();
    asked.add(id);
    void window.drashti.shastra.passage(id).then((info) => {
      usePassageNames.setState({ [id]: info?.reference ?? null });
    });
  }, [id, known]);
  return known ?? null;
}
