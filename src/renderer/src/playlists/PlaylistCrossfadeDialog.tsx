import { useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, NumberInput } from '../ui/Field';

export function PlaylistCrossfadeDialog({
  playlistId,
  initialMs,
  onClose,
}: {
  playlistId: string;
  initialMs: number;
  onClose: () => void;
}) {
  const [seconds, setSeconds] = useState(String(initialMs / 1000));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ms = Math.round(Number(seconds) * 1000);
  const valid = seconds.trim() !== '' && Number.isFinite(ms) && ms >= 0 && ms <= 10_000;
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const node = (await window.drashti.playlists.tree()).find((p) => p.id === playlistId);
      if (!node || node.isFolder || node.template) {
        setProblem('That playlist is no longer there: close this window and open it again.');
        return;
      }
      const result = await window.drashti.playlists.setPlayOptions(playlistId, {
        shuffle: node.playback?.shuffle ?? false,
        repeatAll: node.playback?.repeatAll ?? false,
        crossfadeMs: ms,
      });
      if (!result.ok) setProblem(result.message);
      else onClose();
    } catch {
      setProblem('The crossfade could not be saved: try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="Playlist crossfade"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid || saving}
            onClick={() => void save()}
            aria-label="Save crossfade"
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Crossfade seconds"
          hint="0 is off. Videos with Next item blend into the following video. Limited to half the shorter video so only two videos play at once."
          error={!valid ? 'Enter 0 to 10 seconds.' : problem}
        >
          <NumberInput
            value={seconds}
            min={0}
            max={10}
            step={0.1}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </Field>
        <Button onClick={() => setSeconds('0')}>Off</Button>
        <p className="text-xs text-muted">
          The next video prepares silently. If it cannot get ready, the current picture stays and LIVE says
          why.
        </p>
      </div>
    </Dialog>
  );
}
