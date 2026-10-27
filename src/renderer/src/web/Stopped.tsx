import { PHONE_STOPPED_TEXT, PHONE_STOPPED_TITLE } from '../../../shared/access';
import { useEngine } from '../engine/engine-store';
import { Mark } from '../ui/Mark';

/*
 * A phone's or tablet's page while its Drashti has stopped (Session 54, access by Gmail): said plainly over the whole
 * page, from the engine's own state as the feed brings it. Nothing under it works anyway: Drashti refuses every
 * request while it is not let in.
 */
export function PhoneStopped() {
  const stopped = useEngine((s) => s.state?.stopped ?? null);
  if (!stopped) return null;
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
