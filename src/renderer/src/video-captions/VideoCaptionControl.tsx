import { useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  captionTrackLabel,
  type VideoCaptionChoice,
  type VideoCaptionResult,
} from '../../../shared/video-captions';
import { useNotice } from '../operator/actions';
import { Button } from '../ui/Button';
import { Menu, menuBelow, type MenuEntry, type MenuPlace } from '../ui/Menu';

const useChoices = create<{ views: Record<string, VideoCaptionChoice> }>(() => ({ views: {} }));
const keep = (mediaId: string, view: VideoCaptionChoice) =>
  useChoices.setState((state) => ({ views: { ...state.views, [mediaId]: view } }));
let connected = false;

function useChoice(mediaId: string): VideoCaptionChoice | null {
  const view = useChoices((state) => state.views[mediaId] ?? null);
  useEffect(() => {
    if (!connected) {
      connected = true;
      window.drashti.videoCaptions.onChanged(({ mediaId: id, view: changed }) => keep(id, changed));
    }
    void window.drashti.videoCaptions
      .view(mediaId)
      .then((read) => keep(mediaId, read))
      .catch(() => {
        useNotice.setState({
          text: 'The caption choices could not be read. Try opening the Captions menu again.',
        });
      });
  }, [mediaId]);
  return view;
}

function take(mediaId: string, result: VideoCaptionResult): void {
  if (result.ok) {
    keep(mediaId, result.view);
    if (result.notice) useNotice.setState({ text: result.notice });
  } else useNotice.setState({ text: result.message });
}

/** The CC menu and the video's right-click Captions entry use these same choices in both modes. */
export function VideoCaptionMenu({
  mediaId,
  at,
  onClose,
}: {
  mediaId: string;
  at: MenuPlace;
  onClose: () => void;
}) {
  const choice = useChoice(mediaId);
  const select = (trackId: string | null) => {
    void window.drashti.videoCaptions
      .select(mediaId, trackId)
      .then((result) => take(mediaId, result))
      .catch(() => {
        useNotice.setState({ text: 'The caption choice could not be kept. Try choosing it again.' });
      });
  };
  const entries: MenuEntry[] = choice
    ? [
        { label: 'Off', checked: choice.selected === null, radio: true, onSelect: () => select(null) },
        ...choice.tracks.map((track) => ({
          label: captionTrackLabel(track),
          checked: choice.selected === track.id,
          radio: true as const,
          onSelect: () => select(track.id),
        })),
      ]
    : [{ label: 'Reading caption choices…', disabled: true, onSelect: () => undefined }];
  entries.push({
    label: 'Add a Caption File…',
    separatorBefore: true,
    onSelect: () => {
      void window.drashti.videoCaptions
        .add(mediaId)
        .then((result) => take(mediaId, result))
        .catch(() => {
          useNotice.setState({ text: 'The caption file could not be added. Try adding it again.' });
        });
    },
  });
  return <Menu at={at} label="Video captions" entries={entries} onClose={onClose} />;
}

/** Compact CC control by the video's own time bar, away from the Audio panel's controls. */
export function VideoCaptionButton({ mediaId }: { mediaId: string }) {
  const choice = useChoice(mediaId);
  const [at, setAt] = useState<MenuPlace | null>(null);
  const selected = choice?.tracks.find((track) => track.id === choice.selected);
  const label = selected ? `Video captions: ${captionTrackLabel(selected)}` : 'Video captions: off';
  return (
    <>
      <Button
        size="sm"
        variant={selected ? 'strong' : 'secondary'}
        aria-label={label}
        title={label}
        aria-pressed={Boolean(selected)}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        data-testid="video-cc"
        onClick={(event) => setAt(menuBelow(event.currentTarget))}
      >
        CC
      </Button>
      {at && <VideoCaptionMenu mediaId={mediaId} at={at} onClose={() => setAt(null)} />}
    </>
  );
}
