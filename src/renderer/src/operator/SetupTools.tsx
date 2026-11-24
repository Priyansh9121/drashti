import { useState } from 'react';
import type { Icon } from '../ui/icons';
import {
  AppWindow,
  KeyboardMusic,
  MonitorPlay,
  PictureInPicture2,
  QrCode,
  SlidersHorizontal,
  Video,
} from '../ui/icons';
import { Button } from '../ui/Button';
import { LIVE_SECTION, Panel } from '../ui/Panel';
import { openQrSlide } from '../library/QrSlideDialog';
import { openWindowPicker } from '../live-window/live-window-store';
import { openStreamLink } from '../live-link/live-link-store';
import { openAddInput } from '../video-inputs/video-inputs-store';
import { openPipDialog } from './pip-store';
import { openStudio } from '../lower-thirds/lower-thirds-store';
import { openMidiDialog } from '../midi/MidiTool';
import { openOsc } from '../osc/osc-store';
import { useOperateOnly } from '../simple/simple-features-store';
import { useVideoInputs } from '../video-inputs/video-inputs-store';
import { Notice } from '../ui/Notice';
import { InputOnAudience } from './InputOnAudience';
import { InputPicker } from './StageControls';
import {
  SETUP_TOOLS,
  type SetupTool,
  type SetupToolWords,
  type ToolsMenuItem,
} from '../../../shared/setup-tools';

/*
 * The tools' own sections under LIVE (alpha.22; the owner, 24 Nov 2026: "remove more tools, bring out all the features
 * with collapsable, like this. and by default it should be collapsed"): after Timers and Lower Thirds, Show a Window,
 * Show a Stream Link, Video inputs, Picture in Picture and QR code (in the Tools menu's order), then the MIDI controller
 * and OSC control, each a folding section of its own with its own "?", folded at each start as every section under
 * LIVE is. Each holds a line saying what the tool does and the button that opens its window. Their buttons were in
 * More tools from alpha.20 (Session 60, x36), and in the library's rows before. The menu bar's Tools menu opens the
 * same windows (openTool, below).
 */

/** Each tool's button: its test id (the same as when it was in the library), its icon, and what it opens. */
const TOOL_PARTS: Record<SetupTool, { testId: string; icon: Icon; open: () => void }> = {
  'show-a-window': { testId: 'show-a-window', icon: AppWindow, open: openWindowPicker },
  'show-a-stream-link': { testId: 'show-a-stream-link', icon: MonitorPlay, open: openStreamLink },
  'add-video-input': { testId: 'add-video-input', icon: Video, open: openAddInput },
  'picture-in-picture': { testId: 'pip-open', icon: PictureInPicture2, open: openPipDialog },
  'qr-code': { testId: 'qr-code-open', icon: QrCode, open: openQrSlide },
};

const WORDS = Object.fromEntries(SETUP_TOOLS.map((t) => [t.id, t])) as Record<SetupTool, SetupToolWords>;

/** What an item of the Tools menu opens: a setup tool's window as its button does, or another tool's. */
export function openTool(item: ToolsMenuItem): void {
  if (item === 'lower-thirds-studio') void openStudio(null);
  else if (item === 'midi') openMidiDialog();
  else if (item === 'osc') openOsc();
  else TOOL_PARTS[item].open();
}

/** A tool's line saying what it does, then its button, which the line describes. */
function ToolLine({
  testId,
  line,
  label,
  icon,
  open,
}: {
  testId: string;
  line: string;
  label: string;
  icon: Icon;
  open: () => void;
}) {
  const lineId = `${testId}-line`;
  return (
    <>
      <p id={lineId} data-testid={lineId} className="text-xs text-muted">
        {line}
      </p>
      <Button
        variant="secondary"
        size="sm"
        icon={icon}
        data-testid={testId}
        aria-describedby={lineId}
        onClick={open}
      >
        {label}
      </Button>
    </>
  );
}

/** A setup tool's line and button, its words from shared/setup-tools.ts. */
function SetupToolLine({ id }: { id: SetupTool }) {
  const { line, label } = WORDS[id];
  return <ToolLine {...TOOL_PARTS[id]} line={line} label={label} />;
}

/*
 * Each tool's section, one component each, so another place (Simple Mode's chosen features) can show the same one.
 * Each is a collapsible Panel with LIVE_SECTION's folding: folded at each start, kept while Drashti runs.
 */

/** Show a Window: another app's window as the background. */
export function ShowAWindowSection() {
  return (
    <Panel
      {...LIVE_SECTION}
      help="showwindow"
      title="Show a Window"
      icon={AppWindow}
      remember="show-a-window"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="section-show-a-window"
    >
      <SetupToolLine id="show-a-window" />
    </Panel>
  );
}

/** Show a Stream Link: a live stream's link as the background. */
export function StreamLinkSection() {
  return (
    <Panel
      {...LIVE_SECTION}
      help="streamlink"
      title="Show a Stream Link"
      icon={MonitorPlay}
      remember="show-a-stream-link"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="section-show-a-stream-link"
    >
      <SetupToolLine id="show-a-stream-link" />
    </Panel>
  );
}

/**
 * In Simple Mode (alpha.22, Video inputs chosen for it in Edit › Simple Mode Features…): which input it is, and LIVE's
 * one press that puts it up on the audience and takes it off again. Adding one, and the rest, stay Pro Mode's.
 */
function VideoInputsOperate() {
  const inputs = useVideoInputs((s) => s.inputs);
  const [problem, setProblem] = useState<string | null>(null);
  if (inputs !== null && inputs.length === 0)
    return (
      <p className="text-xs text-muted" data-testid="video-inputs-none">
        No video input on this computer yet: one is added in Pro Mode.
      </p>
    );
  return (
    <>
      {inputs !== null && inputs.length > 1 && <InputPicker onProblem={setProblem} />}
      <InputOnAudience className="" />
      {problem && (
        <Notice tone="danger" compact>
          {problem}
        </Notice>
      )}
    </>
  );
}

/** Video inputs: Add a Video Input… names a camera or capture input for Media; in Simple Mode, its one press. */
export function VideoInputsSection() {
  const operateOnly = useOperateOnly();
  return (
    <Panel
      {...LIVE_SECTION}
      help="videoinputs"
      title="Video inputs"
      icon={Video}
      remember="video-inputs"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="section-video-inputs"
    >
      {operateOnly ? <VideoInputsOperate /> : <SetupToolLine id="add-video-input" />}
    </Panel>
  );
}

/** Picture in Picture: something small in a corner of the screens. */
export function PictureInPictureSection() {
  return (
    <Panel
      {...LIVE_SECTION}
      help="pip"
      title="Picture in Picture"
      icon={PictureInPicture2}
      remember="picture-in-picture"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="section-picture-in-picture"
    >
      <SetupToolLine id="picture-in-picture" />
    </Panel>
  );
}

/** QR code: a slide with a large code, or the code saved as a picture. */
export function QrCodeSection() {
  return (
    <Panel
      {...LIVE_SECTION}
      help="qrcode"
      title="QR code"
      icon={QrCode}
      remember="qr-code"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="section-qr-code"
    >
      <SetupToolLine id="qr-code" />
    </Panel>
  );
}

/** The MIDI controller: pads, keys or a foot switch mapped to the show's actions. */
export function MidiSection() {
  return (
    <Panel
      {...LIVE_SECTION}
      help="midi"
      title="MIDI controller"
      icon={KeyboardMusic}
      remember="midi"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="section-midi"
    >
      <ToolLine
        testId="open-midi"
        line="A MIDI controller’s pads, keys or foot switch can work Next, Back, Clear all, Black-out and the Wallpaper."
        label="MIDI controller…"
        icon={KeyboardMusic}
        open={openMidiDialog}
      />
    </Panel>
  );
}

/** OSC control: a sound or lighting console on the network running the show. */
export function OscSection() {
  return (
    <Panel
      {...LIVE_SECTION}
      help="osc"
      title="OSC control"
      icon={SlidersHorizontal}
      remember="osc"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="section-osc"
    >
      <ToolLine
        testId="open-osc"
        line="A sound or lighting console, or Companion, on this network can run the show. It is off until an admin turns it on."
        label="OSC control…"
        icon={SlidersHorizontal}
        open={openOsc}
      />
    </Panel>
  );
}
