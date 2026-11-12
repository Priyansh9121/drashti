import { Component, type ReactNode } from 'react';

/*
 * Around the GPU warm-up's drawing (WarmUp.tsx; Session 57, the review of h-maskperf's MEDIUM-1). The warm-up draws
 * the show's own scenes, a deck's code among them, on every hall screen, the stream's page and the LIVE picture at
 * every start. On the hall's screens and the stream's page it sat outside the show's boundary (SceneBoundary), so a
 * throw in any of its scenes took the whole page away: black, reloaded by Main, and black again as the warm-up failed
 * again. Now a scene that fails as it draws ends the warm-up there: this draws nothing in its place and says so
 * (`onError`: the warm-up's own hand-over, as when it is drawn to its end), and the page draws the show, its GPU
 * making what the show needs as the show first draws it, as on a computer that skips the warm-up. The error still
 * goes to the page's root, as every caught one does, told apart there as the warm-up's (`warmUp`,
 * ui/render-errors.ts): Main logs it and reloads nothing for it.
 */

interface Props {
  /** The warm-up ends there. */
  onError: () => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class WarmUpBoundary extends Component<Props, State> {
  /** Its caught errors are the warm-up's (the page's root reports them so: ui/render-errors.ts). */
  readonly warmUp = true;

  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
