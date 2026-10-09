import { Component, type ReactNode } from 'react';

/*
 * Around a screen's scene (Session 23): if drawing it fails, the screen shows
 * plain black, never words, and tries again with the next change (`resetKey`,
 * the engine's revision). The error itself goes to the root's onCaughtError,
 * which tells the main process; an output is also reloaded once.
 */

interface Props {
  resetKey: number;
  /** The black box's own classes, when it does not fill a positioned parent (the operator's preview). */
  fallbackClassName?: string;
  children: ReactNode;
}

interface State {
  failedAt: number | null;
}

export class SceneBoundary extends Component<Props, State> {
  override state: State = { failedAt: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failedAt: Number.NaN };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Failed while drawing this revision: remember it. A later revision draws the scene again.
    if (state.failedAt !== null && Number.isNaN(state.failedAt)) return { failedAt: props.resetKey };
    if (state.failedAt !== null && state.failedAt !== props.resetKey) return { failedAt: null };
    return null;
  }

  override render(): ReactNode {
    if (this.state.failedAt !== null)
      return (
        <div
          className={this.props.fallbackClassName ?? 'absolute inset-0 bg-black'}
          data-render-error=""
          aria-hidden="true"
        />
      );
    return this.props.children;
  }
}
