import type { StreamResult } from '../../../shared/stream';
import { useNotice } from '../operator/actions';
import { Button, type ButtonSize } from '../ui/Button';
import { CircleDot, FolderOpen, Mic, Square } from '../ui/icons';
import { MenuButton } from '../ui/Menu';
import { streamAction, useStream } from './stream-store';

function recordAction(run: () => Promise<StreamResult>): void {
  void streamAction(run).then((result) => {
    if (!result.ok) useNotice.setState({ text: result.message });
  });
}

export function RecordingFolder() {
  const rec = useStream((s) => s.status?.recording);
  return (
    <Button
      icon={FolderOpen}
      disabled={rec?.state !== 'off'}
      data-testid="recording-folder"
      onClick={() => recordAction(() => window.drashti.stream.pickFolder())}
    >
      {rec?.folder ? 'Change recording folder…' : 'Choose recording folder…'}
    </Button>
  );
}

/** The same Record control in Pro and Simple Mode. */
export function RecordButton({ size = 'md' }: { size?: ButtonSize }) {
  const status = useStream((s) => s.status);
  const rec = status?.recording;
  if (!rec) return null;
  if (rec.state !== 'off')
    return (
      <Button
        size={size}
        icon={Square}
        data-testid="stop-recording"
        onClick={() => recordAction(() => window.drashti.stream.stopRecording())}
      >
        {rec.kind === 'sound' ? 'Stop sound recording' : 'Stop video recording'}
      </Button>
    );
  return (
    <MenuButton
      label="Record"
      size={size}
      variant="secondary"
      icon={CircleDot}
      testId="start-recording"
      entries={[
        {
          label: 'Record sound',
          icon: Mic,
          disabled: !rec.folder,
          onSelect: () => recordAction(() => window.drashti.stream.startSoundRecording()),
        },
        {
          label: 'Record video',
          disabled: !rec.folder || !status.ffmpeg.available,
          onSelect: () => recordAction(() => window.drashti.stream.startRecording()),
        },
        {
          label: rec.folder ? 'Change recording folder…' : 'Choose recording folder…',
          icon: FolderOpen,
          separatorBefore: true,
          onSelect: () => recordAction(() => window.drashti.stream.pickFolder()),
        },
      ]}
    >
      Record
    </MenuButton>
  );
}
