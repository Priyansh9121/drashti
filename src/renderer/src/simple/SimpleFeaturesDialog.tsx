import { useState } from 'react';
import type { SimpleFeature } from '../../../shared/simple-features';
import {
  SIMPLE_FEATURES,
  SIMPLE_FEATURES_FULL,
  SIMPLE_FEATURES_LINE,
  SIMPLE_FEATURES_MAX,
} from '../../../shared/simple-features';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Notice } from '../ui/Notice';
import { Toggle } from '../ui/Toggle';
import { closeSimpleFeatures, useSimpleFeatures } from './simple-features-store';

/*
 * Edit › Simple Mode Features… (alpha.22; the owner, 24 Nov 2026: "in edit, saying that the features can be brought to
 * simple mode, only 1-2 and max 3 … like an on and off button"): Pro Mode's small window with a line saying to keep it
 * to a few, then one row for each tool with its own on/off switch, as Music steps aside for a video has. With three
 * on, the others' switches wait, saying why. Each change is kept at once (the main process keeps the rule too, and
 * Simple Mode refuses any change).
 */
export function SimpleFeaturesDialog() {
  const open = useSimpleFeatures((s) => s.open);
  const chosen = useSimpleFeatures((s) => s.chosen);
  const [problem, setProblem] = useState<string | null>(null);
  if (!open) return null;
  const full = chosen.length >= SIMPLE_FEATURES_MAX;
  const close = () => {
    setProblem(null);
    closeSimpleFeatures();
  };
  const turn = async (feature: SimpleFeature, on: boolean) => {
    const result = await window.drashti.app.setSimpleFeature(feature, on);
    if (result.ok) {
      setProblem(null);
      useSimpleFeatures.setState({ chosen: result.chosen });
    } else setProblem(result.message);
  };
  return (
    <Dialog
      title="Simple Mode Features"
      subtitle={SIMPLE_FEATURES_LINE}
      onClose={close}
      size="md"
      testId="simple-features-dialog"
      footer={
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        <ul className="space-y-1.5" aria-label="Pro Mode’s tools">
          {SIMPLE_FEATURES.map((f) => {
            const on = chosen.includes(f.id);
            return (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-md border border-line bg-panel-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{f.name}</p>
                  <p className="text-xs text-muted">{f.line}</p>
                </div>
                <Toggle
                  checked={on}
                  label={f.name}
                  hideLabel
                  disabled={full && !on}
                  data-testid={`simple-feature-${f.id}`}
                  onChange={(next) => {
                    void turn(f.id, next);
                  }}
                />
              </li>
            );
          })}
        </ul>
        {full && (
          <p role="status" className="text-sm text-warning-fg" data-testid="simple-features-full">
            {SIMPLE_FEATURES_FULL}
          </p>
        )}
        <p className="text-xs text-muted">
          In Simple Mode each one is a section of its own under Audio, folded until it is opened. Setting a
          tool up stays in Pro Mode.
        </p>
        {problem && (
          <Notice tone="danger" compact onDismiss={() => setProblem(null)}>
            {problem}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
