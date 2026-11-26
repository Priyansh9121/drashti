import { beforeEach, describe, expect, it } from 'vitest';
import { useMode } from '../operator/mode-store';
import { useSimpleFeatures } from '../simple/simple-features-store';
import { openChatFromPop, useChatOpen } from './ChatPop';

/*
 * A chat popup's click (alpha.24; the owner's QA24-CHATPOP-2 = B): the popup comes in both modes, and a click opens
 * Chat where Chat is this mode's (Pro Mode, or Simple Mode with Chat one of Simple Mode Features' chosen tools);
 * otherwise it only closes the popup. Simple Mode never gains a section that was not chosen (the owner's "only 1-2 and
 * max 3"), and a click in one mode never carries over to the other: Simple Mode shows the chosen tools only, and a
 * section takes only an ask made after it mounted (ui/open-asks.ts). The window itself: tests/e2e/chat-pop.spec.ts.
 * Placeholder parts only.
 */

const asked = () => useChatOpen.getState().asked;

beforeEach(() => {
  useChatOpen.setState({ asked: 0 });
  useMode.setState({ mode: 'pro' });
  useSimpleFeatures.setState({ chosen: [] });
});

describe('a popup click', () => {
  it('in Pro Mode asks Chat to open', () => {
    openChatFromPop();
    expect(asked()).toBe(1);
  });

  it('in Simple Mode with Chat chosen asks Chat to open', () => {
    useMode.setState({ mode: 'simple' });
    useSimpleFeatures.setState({ chosen: ['chat'] });
    openChatFromPop();
    expect(asked()).toBe(1);
  });

  it('in Simple Mode without Chat asks nothing: it only closes the popup', () => {
    useMode.setState({ mode: 'simple' });
    useSimpleFeatures.setState({ chosen: ['timers'] });
    openChatFromPop();
    expect(asked()).toBe(0);
  });
});
