/*
 * The setup tools (Session 60, x36; the owner, 19 Nov 2026: "we want to keep the QR code as well, but somewhere
 * accesibble, … maybe somewhere we can access and remember easily, below lower thirds?", and his answer "A, More tools +
 * menu"): Show a Window…, Add a Video Input…, Picture in Picture… and QR code… each set up something to show that is not
 * a slide or a file, in a small window of its own. Their buttons were in the library's rows (Media's and Presentations')
 * until alpha.20, then in More tools; since alpha.22 (the owner: "remove more tools, bring out all the features with
 * collapsable") each is a section of its own under LIVE, with its one line, and they are in the menu bar's Tools menu
 * (Pro Mode), with the Lower Thirds studio, the MIDI controller and OSC. A named video
 * input or window still shows in Media as one click to put it up: only the buttons that set them up moved.
 */

/**
 * The setup tools, as their sections and the Tools menu name them: the four of Session 60, and Show a Stream Link… (alpha.20,
 * the playback set's slice 8) after Show a Window….
 */
export type SetupTool =
  'show-a-window' | 'show-a-stream-link' | 'add-video-input' | 'picture-in-picture' | 'qr-code';

/** What the Tools menu opens: the setup tools, then the Lower Thirds studio, the MIDI controller and OSC. */
export type ToolsMenuItem = SetupTool | 'lower-thirds-studio' | 'midi' | 'osc';

export interface SetupToolWords {
  id: SetupTool;
  /** Its button's and its menu item's words. */
  label: string;
  /** What it does, in one line, above its button in its section under LIVE (as the MIDI controller's line is). */
  line: string;
}

/** In their sections' order under LIVE (after Lower Thirds), and first in the Tools menu. */
export const SETUP_TOOLS: readonly SetupToolWords[] = [
  {
    id: 'show-a-window',
    label: 'Show a Window…',
    line: 'Another app’s window (a Zoom meeting, say), live on the screens as the background.',
  },
  {
    id: 'show-a-stream-link',
    label: 'Show a Stream Link…',
    line: 'A live stream’s link (an HLS link, or a YouTube live stream’s), live on the screens as the background, its sound in the hall.',
  },
  {
    id: 'add-video-input',
    label: 'Add a Video Input…',
    line: 'Names a camera or capture input on this computer (a video mixer’s USB output, say): one click on it in Media puts it up.',
  },
  {
    id: 'picture-in-picture',
    label: 'Picture in Picture…',
    line: 'Something small in a corner of the screens while the main picture carries on: a camera, a picture or video, a window, or the slides.',
  },
  {
    id: 'qr-code',
    label: 'QR code…',
    line: 'Makes a slide with a large QR code of a link or words, or saves the code as a picture.',
  },
];

/** The Tools menu, in its order: each item's id in the menu is `tools-<id>`. */
export const TOOLS_MENU: readonly { id: ToolsMenuItem; label: string }[] = [
  ...SETUP_TOOLS.map(({ id, label }) => ({ id, label })),
  { id: 'lower-thirds-studio', label: 'Lower Thirds Studio…' },
  { id: 'midi', label: 'MIDI Controller…' },
  { id: 'osc', label: 'OSC Control…' },
];

/** Whether a message from the main process names one of the Tools menu's items. */
export const isToolsMenuItem = (x: unknown): x is ToolsMenuItem => TOOLS_MENU.some((t) => t.id === x);
