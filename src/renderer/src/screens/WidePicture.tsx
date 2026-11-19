import { useState } from 'react';
import type { ScreenGroupConfig } from '../../../shared/screens';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Field';
import { screensAction } from './screens-store';

/*
 * One wide picture… (x27, the owner's Q-x27-3 A: edge blend): an audience group's two to four screens side by side make
 * one picture, each overlapping the next by the pixels given; Drashti gives each screen the wide canvas, its part of it
 * and the ramps over its overlaps (main/outputs/screens-service.ts makeWidePicture). Each screen's own corners then
 * line the overlaps up on the wall, in Adjust the picture…. Separate pictures undoes it.
 */

/** The overlap offered first: 15 % of a screen's width, as projectors' edge blends usually start. */
const FIRST_SHARE = 0.15;

export function WidePicture({ group, onClose }: { group: ScreenGroupConfig; onClose: () => void }) {
  const first = group.screens[0];
  const width = first?.geometry?.part?.width ?? first?.canvasWidth ?? 1920;
  const most = Math.floor(width / 2);
  const wide = group.screens.some((s) => s.geometry?.part);
  const [text, setText] = useState(String(Math.round(width * FIRST_SHARE)));
  const overlap = Number(text);
  const fits = Number.isInteger(overlap) && overlap >= 1 && overlap <= most;
  const names = group.screens.map((s) => s.name).join(', then ');
  return (
    <Dialog
      title="One wide picture"
      subtitle={`${group.name}: ${names}, left to right`}
      size="md"
      onClose={onClose}
      closeLabel="Close One wide picture"
      testId="wide-picture"
      footer={
        <>
          {wide && (
            <Button
              data-testid="wide-separate"
              onClick={() => {
                void screensAction(() => window.drashti.screens.separatePictures(group.id)).then((ok) => {
                  if (ok) onClose();
                });
              }}
            >
              Separate pictures
            </Button>
          )}
          <Button
            variant="primary"
            data-testid="wide-make"
            disabled={!fits}
            onClick={() => {
              void screensAction(() => window.drashti.screens.widePicture(group.id, overlap)).then((ok) => {
                if (ok) onClose();
              });
            }}
          >
            {wide ? 'Change the overlap' : 'Make one wide picture'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          The {group.screens.length} screens of this group, in its order from left to right, show one picture
          together, each overlapping the next. Over each overlap the picture fades out on one screen as it
          fades in on the other, so the wall shows it once, evenly lit. Line them up with each screen’s Adjust
          the picture….
        </p>
        <label className="flex items-center gap-2 text-sm">
          Overlap
          <TextInput
            className="w-20 tabular-nums"
            inputMode="numeric"
            data-testid="wide-overlap"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          pixels of the canvas (1 to {most}, half a screen at most)
        </label>
      </div>
    </Dialog>
  );
}
