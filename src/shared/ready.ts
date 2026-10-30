import { endsBarShown, leftText, offlineLeftText, type AccessPhase } from './access';
import { shortcutText } from './keymap';
import type { ScreenRole, ScreenState } from './screens';

/*
 * Ready? (Session 55, Part 8, the owner's idea H): one press before the sabha checks the screens, the sound output and
 * the chosen video input; access and the open playlist's files; the charger, sleep and notifications. Each line is
 * green (nothing to do) or amber, with what to do; a line Drashti cannot tell here is amber and says so. The main
 * process reads the facts (main/ready/ready-facts.ts: never at start, never the keychain, slow reads off the main
 * thread) and these words come from them, here, so they are tested apart from any computer.
 */

export type ReadyId =
  'screens' | 'sound' | 'video-input' | 'access' | 'files' | 'charger' | 'sleep' | 'notifications';

export interface ReadyLine {
  id: ReadyId;
  /** What it is about: "Screens". */
  title: string;
  /** Green: nothing to do. Amber: look at it (`todo` says how), or Drashti could not tell here (`unknown`). */
  ok: boolean;
  /** What Drashti found, in a sentence. */
  said: string;
  /** What to do, on an amber line; null on a green one. */
  todo: string | null;
  /** Drashti could not check it on this computer: the line says so, and what to check by hand. */
  unknown?: boolean;
}

/** What one of this computer's screens (or a node's) is doing, for Ready?. */
export interface ReadyOutput {
  name: string;
  role: ScreenRole;
  /** Its state, or 'not-drawing': open and visible, but its page has not said it draws for a while. */
  state: ScreenState | 'not-drawing';
  /** On a node (another computer). */
  node: boolean;
}

/** What the main process found, as plain facts (main/ready/ready-facts.ts reads them). */
export interface ReadyFacts {
  platform: string;
  screens: {
    /** This computer's connected displays other than the one with the controls. */
    others: number;
    /** The computer mirrors its screen onto another display. */
    mirrored: boolean;
    switches: { audience: boolean; stage: boolean };
    outputs: ReadyOutput[];
  };
  sound: {
    state: 'chosen' | 'default' | 'missing';
    /** The sound player has looked at the outputs since it started. */
    checked: boolean;
    /** The chosen output's name; null for the computer's own choice. */
    chosen: string | null;
    playerRunning: boolean;
  };
  videoInput: {
    /** The chosen input (its name, and the camera's or capture card's own name), or null for none. */
    chosen: { name: string; device: string } | null;
    /** The camera permission: 'granted', 'denied', 'restricted', 'not-determined' or 'unknown'. */
    access: string;
    /** The cameras the window last saw, or null before it has looked. */
    seen: string[] | null;
  };
  access: { phase: AccessPhase; stopsInMs: number | null; endsInMs: number | null };
  /** The open playlist, and the names of its rows whose file or presentation is missing; null when none is open. */
  playlist: { name: string; problems: string[] } | null;
  /** On battery (null: Drashti cannot tell); and whether Drashti keeps the computer awake now. */
  power: { onBattery: boolean | null; keptAwake: boolean };
  /** Notifications silenced (Do Not Disturb, Focus, Focus assist): null when Drashti cannot tell. */
  focus: { quiet: boolean | null };
}

/** The whole answer: the lines, when, and the missing files' media ids (for Find missing media…). */
export interface ReadyReport {
  at: number;
  lines: ReadyLine[];
  missingMediaIds: string[];
}

/** What Ready? cannot check, said under its lines. */
export const READY_CANNOT_CHECK: readonly string[] = [
  'Whether the projector is on, on the right input, in focus and bright enough: look at the hall.',
  'What the hall hears: the mixer, its channel and the speakers. Test sound plays a short tone to the chosen output.',
  'The stream: the internet’s speed and YouTube’s side. Open Stream before you go live.',
  'The phones, tablets and nodes: their own batteries and Wi-Fi.',
];

const SHOWN_ROLES: ReadonlySet<ScreenRole> = new Set(['audience', 'stage', 'keyfill', 'other']);

const list = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;

const quoted = (name: string): string => `“${name}”`;

function screensLine(facts: ReadyFacts): ReadyLine {
  const { screens, platform } = facts;
  const title = 'Screens';
  const shown = screens.outputs.filter((o) => SHOWN_ROLES.has(o.role));
  const problems: string[] = [];
  const todos: string[] = [];
  if (!screens.switches.audience) {
    problems.push('Audience is off on this computer');
    todos.push(`Press ${shortcutText('toggleAudience', platform)} (Audience) to turn the hall’s screens on.`);
  }
  if (!screens.switches.stage && shown.some((o) => o.role === 'stage')) {
    problems.push('Stage is off: the stage screens show the audience picture');
    todos.push(
      `Press ${shortcutText('toggleStage', platform)} (Stage) if the stage screens should show their layout.`,
    );
  }
  if (screens.mirrored) {
    problems.push('this computer mirrors its screen');
    todos.push(
      'Extend the display instead of mirroring it (the computer’s Displays settings), so the hall sees only the audience picture.',
    );
  }
  const gone = shown.filter((o) => o.state === 'missing-display');
  if (gone.length > 0) {
    problems.push(`${list(gone.map((o) => o.name))}: no display connected`);
    todos.push(
      'Check the cable and that the projector or screen is on; Drashti uses it as soon as it is connected.',
    );
  }
  const stopped = shown.filter((o) => o.state === 'stopped');
  if (stopped.length > 0) {
    problems.push(`${list(stopped.map((o) => o.name))} stopped after it kept failing`);
    todos.push('Open Screens and press Try again (or restart Drashti).');
  }
  const quiet = shown.filter((o) => o.state === 'not-drawing');
  if (quiet.length > 0) {
    problems.push(`${list(quiet.map((o) => o.name))} has not drawn for a while`);
    todos.push('Wait a few seconds and check again; if it stays, open Screens and press Try again.');
  }
  const offline = shown.filter((o) => o.state === 'node-offline');
  if (offline.length > 0) {
    problems.push(`${list(offline.map((o) => o.name))} is on a node that is not connected`);
    todos.push('Check that the node computer is on and on this network.');
  }
  const showing = shown.filter((o) => o.state === 'showing');
  const hall = showing.filter((o) => o.role === 'audience' || o.role === 'keyfill');
  if (hall.length === 0 && screens.switches.audience && gone.length === 0 && stopped.length === 0) {
    problems.push(
      screens.others === 0
        ? 'no screen is connected besides this one'
        : 'no screen shows the audience picture',
    );
    todos.push(
      screens.others === 0
        ? 'Plug in the projector, extended (not mirrored): Drashti gives it the audience picture by itself.'
        : 'Open Screens and give the projector’s display the Audience job.',
    );
  }
  if (problems.length > 0) {
    const first = problems[0] ?? '';
    return {
      id: 'screens',
      title,
      ok: false,
      said: `${first.charAt(0).toUpperCase()}${first.slice(1)}${problems.length > 1 ? `; ${problems.slice(1).join('; ')}` : ''}.`,
      todo: todos.join(' '),
    };
  }
  return {
    id: 'screens',
    title,
    ok: true,
    said: `Showing: ${list(showing.map((o) => o.name))}.`,
    todo: null,
  };
}

function soundLine(facts: ReadyFacts): ReadyLine {
  const { sound } = facts;
  const title = 'Sound output';
  if (!sound.playerRunning)
    return {
      id: 'sound',
      title,
      ok: false,
      said: 'Drashti’s sound player is not running.',
      todo: 'Quit Drashti and start it again before the sabha.',
    };
  if (!sound.checked)
    return {
      id: 'sound',
      title,
      ok: false,
      unknown: true,
      said: 'The sound player has not looked at the outputs yet.',
      todo: 'Check again in a moment.',
    };
  if (sound.state === 'missing')
    return {
      id: 'sound',
      title,
      ok: false,
      said: `The chosen output, ${quoted(sound.chosen ?? 'the one chosen')}, is not connected: sound goes to the computer’s own output.`,
      todo: 'Plug it in (its cable, its power), or choose another in Screens, under Sound.',
    };
  return {
    id: 'sound',
    title,
    ok: true,
    said:
      sound.state === 'chosen' && sound.chosen !== null
        ? `Sound goes to ${quoted(sound.chosen)}.`
        : 'Sound goes to the output the computer chooses (none is chosen in Screens).',
    todo: null,
  };
}

function videoInputLine(facts: ReadyFacts): ReadyLine {
  const { videoInput, platform } = facts;
  const title = 'Video input';
  const chosen = videoInput.chosen;
  if (chosen === null)
    return {
      id: 'video-input',
      title,
      ok: true,
      said: 'No video input is chosen: nothing to check.',
      todo: null,
    };
  if (videoInput.access === 'denied' || videoInput.access === 'restricted')
    return {
      id: 'video-input',
      title,
      ok: false,
      said: `Drashti may not use cameras on this computer, so ${quoted(chosen.name)} cannot show.`,
      todo:
        platform === 'win32'
          ? 'Allow it in Settings › Privacy & security › Camera, then start Drashti again.'
          : 'Allow it in System Settings › Privacy & Security › Camera, then start Drashti again.',
    };
  if (videoInput.seen === null)
    return {
      id: 'video-input',
      title,
      ok: false,
      unknown: true,
      said: `Drashti has not looked at this computer’s cameras yet, so it can’t tell whether ${quoted(chosen.name)} is connected.`,
      todo: 'Put the video input up once (or open its list in the Stage screen panel), then check again.',
    };
  if (videoInput.seen.includes(chosen.device))
    return {
      id: 'video-input',
      title,
      ok: true,
      said: `${quoted(chosen.name)} (${chosen.device}) is connected.`,
      todo: null,
    };
  return {
    id: 'video-input',
    title,
    ok: false,
    said: `${quoted(chosen.name)} (${chosen.device}) is not connected.`,
    todo: 'Plug in the camera or capture card (its cable, its power), then check again.',
  };
}

function accessLine(facts: ReadyFacts): ReadyLine {
  const { access } = facts;
  const title = 'Access';
  if (access.phase === 'warning')
    return {
      id: 'access',
      title,
      ok: false,
      said: `Drashti can’t reach the access list: it keeps working for ${offlineLeftText(access.stopsInMs ?? 0)} more.`,
      todo: 'Connect this computer to the internet before the sabha, so the list can answer.',
    };
  if (access.phase === 'in' && endsBarShown(access.endsInMs))
    return {
      id: 'access',
      title,
      ok: false,
      said: `Access on this computer ends in ${leftText(access.endsInMs)}.`,
      todo: 'Ask the person who approves access for more time.',
    };
  if (access.phase === 'in')
    return { id: 'access', title, ok: true, said: 'Drashti is let in on this computer.', todo: null };
  if (access.phase === 'checking')
    return {
      id: 'access',
      title,
      ok: false,
      unknown: true,
      said: 'Drashti is still checking its access.',
      todo: 'Wait a moment, then check again.',
    };
  return {
    id: 'access',
    title,
    ok: false,
    said: 'Drashti is not let in on this computer.',
    todo: 'Ask the person who approves access.',
  };
}

function filesLine(facts: ReadyFacts): ReadyLine {
  const { playlist } = facts;
  const title = 'Files';
  if (playlist === null)
    return {
      id: 'files',
      title,
      ok: false,
      said: 'No playlist is open, so no files were checked.',
      todo: 'Open the sabha’s playlist, then check again.',
    };
  const n = playlist.problems.length;
  if (n === 0)
    return {
      id: 'files',
      title,
      ok: true,
      said: `Every file in ${quoted(playlist.name)} is there.`,
      todo: null,
    };
  const shown = playlist.problems.slice(0, 3);
  const more = n - shown.length;
  return {
    id: 'files',
    title,
    ok: false,
    said: `${String(n)} ${n === 1 ? 'file' : 'files'} in ${quoted(playlist.name)} ${n === 1 ? 'is' : 'are'} missing: ${shown.join(', ')}${more > 0 ? ` and ${String(more)} more` : ''}.`,
    todo: 'Find them with Find missing media…, or take those rows out of the playlist.',
  };
}

function chargerLine(facts: ReadyFacts): ReadyLine {
  const title = 'Charger';
  if (facts.power.onBattery === null)
    return {
      id: 'charger',
      title,
      ok: false,
      unknown: true,
      said: 'Drashti can’t tell whether this computer is on its charger.',
      todo: 'Check that the charger is plugged in and switched on.',
    };
  return facts.power.onBattery
    ? {
        id: 'charger',
        title,
        ok: false,
        said: 'This computer is running on its battery.',
        todo: 'Plug in the charger (and switch it on at the wall).',
      }
    : { id: 'charger', title, ok: true, said: 'This computer is on mains power.', todo: null };
}

function sleepLine(facts: ReadyFacts): ReadyLine {
  const title = 'Sleep';
  return facts.power.keptAwake
    ? {
        id: 'sleep',
        title,
        ok: true,
        said: 'Drashti keeps this computer and its screens awake while its screens show.',
        todo: null,
      }
    : {
        id: 'sleep',
        title,
        ok: false,
        said: 'Nothing keeps this computer awake yet: Drashti does so once a screen shows.',
        todo: 'Plug in the projector (Drashti then keeps the computer awake), or set the computer never to sleep while on its charger.',
      };
}

function notificationsLine(facts: ReadyFacts): ReadyLine {
  const title = 'Notifications';
  const windows = facts.platform === 'win32';
  const how = windows
    ? 'turn on Do not disturb (Windows 11: Settings › System › Notifications) or Focus assist, Alarms only (Windows 10: the Action Center)'
    : 'turn on Do Not Disturb (Control Centre › Focus)';
  if (facts.focus.quiet === null)
    return {
      id: 'notifications',
      title,
      ok: false,
      unknown: true,
      said: windows
        ? 'Drashti can’t tell whether Focus assist or Do not disturb is on on this computer.'
        : 'Drashti can’t tell whether Focus is on: macOS keeps it private.',
      todo: `To be sure no notification pops up or makes a sound, ${how}.`,
    };
  if (facts.focus.quiet)
    return {
      id: 'notifications',
      title,
      ok: true,
      said: windows
        ? 'Focus assist (Do not disturb) is on: no notification pops up.'
        : 'Do Not Disturb (Focus) is on: no notification pops up.',
      todo: null,
    };
  return {
    id: 'notifications',
    title,
    ok: false,
    said: 'Notifications can pop up and make sounds during the sabha.',
    todo: `${how.charAt(0).toUpperCase()}${how.slice(1)}.`,
  };
}

/** Ready?'s lines from the facts, in the order the operator reads them. */
export function readyLines(facts: ReadyFacts): ReadyLine[] {
  return [
    screensLine(facts),
    soundLine(facts),
    videoInputLine(facts),
    accessLine(facts),
    filesLine(facts),
    chargerLine(facts),
    sleepLine(facts),
    notificationsLine(facts),
  ];
}
