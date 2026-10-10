import { Component, type ReactNode } from 'react';
import { Button } from './Button';
import { ErrorState } from './States';

/*
 * Around a whole control window (the operator's, a node's; Session 23): if it
 * fails as it draws, it says so and offers to reload this window alone. The
 * screens are other windows: they keep their picture. The error goes to the
 * root's onCaughtError, which tells the main process.
 */

interface Props {
  /** "Reload the operator window", say. */
  reloadLabel: string;
  children: ReactNode;
}

export class WindowBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-ink" data-window-error="">
        <ErrorState
          title="This window stopped working"
          action={
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                location.reload();
              }}
            >
              {this.props.reloadLabel}
            </Button>
          }
        >
          The screens are not affected: they keep their picture. Reloading brings this window back as it was.
        </ErrorState>
      </div>
    );
  }
}
