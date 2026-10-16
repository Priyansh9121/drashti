import { useState } from 'react';
import { Notice } from '../ui/Notice';
import { useStream } from './stream-store';

/*
 * No sound (Session 31). On air or recording, the stream has had nothing above -50 dBFS for 20 s, or its
 * microphone has been unplugged for 3 s: "No sound" shows beside ON AIR and REC (OnAirBadges), and this
 * one notice says why and what to look at, in Pro Mode and Simple Mode alike. It sits in the window's
 * flow under the header, as a stopped screen's notice does, so it never covers the show controls. It goes
 * by itself when sound is back; closed, it stays closed until the next time. Drashti never switches the
 * microphone by itself.
 */

export function NoSoundNotice() {
  const noSound = useStream((s) => s.status?.noSound ?? null);
  const [closedSince, setClosedSince] = useState<number | null>(null);
  if (!noSound || closedSince === noSound.since) return null;
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="no-sound-notices">
      <Notice
        tone="warning"
        title="No sound on the stream"
        data-testid="no-sound-notice"
        onDismiss={() => {
          setClosedSince(noSound.since);
        }}
      >
        {noSound.message}
      </Notice>
    </div>
  );
}
