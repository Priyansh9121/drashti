import type { Icon } from '../ui/icons';
import { AppWindow, MonitorPlay, PictureInPicture2, QrCode, Video } from '../ui/icons';
import { Button } from '../ui/Button';
import { openQrSlide } from '../library/QrSlideDialog';
import { openWindowPicker } from '../live-window/live-window-store';
import { openStreamLink } from '../live-link/live-link-store';
import { openAddInput } from '../video-inputs/video-inputs-store';
import { openPipDialog } from './pip-store';
import { openStudio } from '../lower-thirds/lower-thirds-store';
import { openMidiDialog } from '../midi/MidiTool';
import { openOsc } from '../osc/osc-store';
import { SETUP_TOOLS, type SetupTool, type ToolsMenuItem } from '../../../shared/setup-tools';

/*
 * The setup tools in More tools (Session 60, x36; the owner's "A, More tools + menu", 19 Nov 2026): Show a Window…,
 * Add a Video Input…, Picture in Picture… and QR code…, under Lower Thirds, the MIDI controller and OSC, each with its
 * one line saying what it does, as the MIDI controller's is. Their buttons were in the library's rows until alpha.20.
 * The menu bar's Tools menu opens the same windows (openTool, below).
 */

/** Each tool's button: its test id (the same as when it was in the library), its icon, and what it opens. */
const TOOL_PARTS: Record<SetupTool, { testId: string; icon: Icon; open: () => void }> = {
  'show-a-window': { testId: 'show-a-window', icon: AppWindow, open: openWindowPicker },
  'show-a-stream-link': { testId: 'show-a-stream-link', icon: MonitorPlay, open: openStreamLink },
  'add-video-input': { testId: 'add-video-input', icon: Video, open: openAddInput },
  'picture-in-picture': { testId: 'pip-open', icon: PictureInPicture2, open: openPipDialog },
  'qr-code': { testId: 'qr-code-open', icon: QrCode, open: openQrSlide },
};

/** What an item of the Tools menu opens: a setup tool's window as its button does, or More tools' other tools'. */
export function openTool(item: ToolsMenuItem): void {
  if (item === 'lower-thirds-studio') void openStudio(null);
  else if (item === 'midi') openMidiDialog();
  else if (item === 'osc') openOsc();
  else TOOL_PARTS[item].open();
}

export function SetupTools() {
  return (
    <div data-testid="setup-tools">
      {SETUP_TOOLS.map((tool) => {
        const { testId, icon, open } = TOOL_PARTS[tool.id];
        const lineId = `${testId}-line`;
        return (
          <div key={tool.id}>
            <p id={lineId} data-testid={lineId} className="px-6 pt-2 text-xs text-muted">
              {tool.line}
            </p>
            <div className="px-6 pt-1 pb-3">
              <Button
                variant="secondary"
                size="sm"
                icon={icon}
                data-testid={testId}
                aria-describedby={lineId}
                onClick={open}
              >
                {tool.label}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
