import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { Video } from '../ui/icons';
import { toggleInputOnAudience, useChosenInput } from '../video-inputs/video-inputs-store';

/*
 * The video input on the audience in one press (Session 55), under LIVE: the chosen video input (the Stage screen
 * panel's Video input; at the mandir the video mixer's programme output) up as the audience's background, the slide
 * staying over it; pressed again, it comes off and what the computer showed comes back. It says whether it is up
 * (pressed). The stage never follows it: the stage screens show their own layout, or with Stage off the audience
 * picture. Shown only on a computer with a video input in Media.
 */
export function InputOnAudience() {
  const input = useChosenInput();
  const up = useEngine((s) => {
    const bg = s.state?.layers.background;
    return input !== null && bg?.kind === 'input' && bg.inputId === input.id;
  });
  if (!input) return null;
  return (
    <div className="px-3 pt-2">
      <Button
        size="sm"
        icon={Video}
        variant={up ? 'live' : 'secondary'}
        aria-pressed={up}
        data-testid="input-on-audience"
        data-input-id={input.id}
        className="w-full justify-start"
        onClick={() => {
          // What goes wrong is said in the notice line, as for every command (operator/actions.ts).
          void toggleInputOnAudience(input.id);
        }}
      >
        {`${input.name} on the audience`}
      </Button>
    </div>
  );
}
