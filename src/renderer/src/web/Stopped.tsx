import { PHONE_STOPPED_TEXT, PHONE_STOPPED_TITLE } from '../../../shared/access';
import { useEngine } from '../engine/engine-store';
import { Mark } from '../ui/Mark';
import { useStopped } from './stopped-store';

/*
 * A phone's or tablet's page while its Drashti has stopped (Session 54, access by Gmail): said plainly over the whole
 * page, from the engine's own state as the feed brings it, or as the feed closed or a request was refused with
 * Drashti's own words for it. Nothing under it works anyway: Drashti refuses every request while it is not let in.
 */
export function PhoneStopped() {
  const stopped = useEngine((s) => s.state?.stopped ?? null);
  // Or told so as its feed closed, or as a request was refused (stopped-store.ts).
  const told = useStopped((s) => s.stopped);
  if (!stopped && !told) return null;
  return (
    <div
      role="alert"
      data-testid="phone-stopped"
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-ink px-5 py-8"
    >
      <div className="max-w-md space-y-4 text-center">
        <p className="flex items-center justify-center gap-2.5 text-base font-bold tracking-wide text-muted">
          <Mark size={28} />
          Drashti
        </p>
        <h1 className="text-2xl font-bold text-fg">{PHONE_STOPPED_TITLE}</h1>
        <p className="text-base text-muted">{PHONE_STOPPED_TEXT}</p>
      </div>
    </div>
  );
}
