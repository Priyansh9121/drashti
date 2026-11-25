import { useMemo } from 'react';
import { deckSlideAt } from '../../../../shared/deck-show';
import type { OrderedSlide } from '../../../../shared/order';
import { useEngine } from '../../engine/engine-store';
import { ScreenPictures } from '../../render/picture-looks';
import { SlideView } from '../../render/SlideView';

/*
 * A deck's step looked through on a phone or tablet (Session 54, D1/D2 review): the still it ends on, its last frame,
 * at once. Since alpha.23 (QA23-PHONE-1, the owner's "no video access in either of simple or pro mode in phone") a
 * phone plays no video: until then the step's motion played once first, its clip through a link made for this device
 * (the network refuses a phone that link now). On this device only.
 */

export function DeckStepDrawn({ s, index }: { s: OrderedSlide; index: number }) {
  const pictures = useEngine((st) => st.state?.pictures);
  const screen = useMemo(() => ({ pictures: pictures ?? {}, liveZoom: null }), [pictures]);
  return (
    <ScreenPictures.Provider value={screen}>
      <div
        style={{ position: 'absolute', inset: 0, background: '#000' }}
        data-testid="viewer-deck-step"
        data-step={index}
        data-phase="held"
      >
        <SlideView slide={deckSlideAt(s.slide.slide, index)} media="still" />
      </div>
    </ScreenPictures.Provider>
  );
}
