import { pathToFileURL } from 'node:url';

/*
 * For tests only: builds files in the shape of ProPresenter 6 XML (as seen in
 * PP6 6.5 files on the dev Mac), filled with placeholder text written for
 * these tests. Never imported by the app.
 */

const b64 = (s: string) => Buffer.from(s, 'latin1').toString('base64');

/** \uN escapes for non-ASCII text, as Cocoa RTF writes them. */
export const rtfUnicode = (text: string) =>
  Array.from(text)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 128 ? ch : `\\uc0\\u${code} `;
    })
    .join('');

/** Cocoa-style RTF for a text box: lines of [text, size in points, colour as "r g b"]. */
export function cocoaRtf(
  lines: [string, number, [number, number, number]][],
  align: 'qc' | 'ql' | 'qr' = 'qc',
  font = 'Helvetica',
): string {
  const colors = lines.map(([, , [r, g, b]]) => `\\red${r}\\green${g}\\blue${b};`).join('');
  const body = lines
    .map(([text, size], i) => `\\f0\\fs${size * 2} \\cf${i + 1} ${rtfUnicode(text)}`)
    .join('\\\n');
  return `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2639\n{\\fonttbl\\f0\\fswiss\\fcharset0 ${font};}\n{\\colortbl;${colors}}\n{\\*\\expandedcolortbl;;}\n\\pard\\pardirnatural\\${align}\\partightenfactor0\n\n${body}}`;
}

/** A video element's time attributes, as ProPresenter 6 writes them. */
const pointsOf = (p: { timeScale?: number; in?: number; out?: number; end?: number } | undefined) =>
  p
    ? ` timeScale="${p.timeScale ?? 600}"` +
      (p.in === undefined ? '' : ` inPoint="${p.in}"`) +
      (p.out === undefined ? '' : ` outPoint="${p.out}"`) +
      (p.end === undefined ? '' : ` endPoint="${p.end}"`)
    : '';

const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');

export interface Pp6TextBox {
  rtf: string;
  rect?: [number, number, number, number];
  fill?: string;
  vertical?: 0 | 1 | 2;
  /** An outline round the box: black, 1 point; or a colour ("r g b a") and width. */
  outline?: boolean | { color: string; width: number };
  /** Degrees, as the file stores them. */
  rotation?: number;
  /** The NSShadow string ("blur|r g b a|{x, y}"), or false for none. */
  shadow?: string | false;
  growToFit?: boolean;
}

/** A shape: an RVShapeElement, or a path that is a rectangle, a circle or something custom. */
export interface Pp6Shape {
  kind: 'shape' | 'rectangle' | 'circle' | 'custom';
  rect: [number, number, number, number];
  fill?: string;
  outline?: { color: string; width: number };
  radius?: number;
  rotation?: number;
  shadow?: boolean;
}

export interface Pp6SlideSpec {
  label?: string;
  notes?: string;
  enabled?: boolean;
  background?: {
    path: string;
    kind: 'image' | 'video';
    loop?: boolean;
    scale?: number;
    /** A video's in and out points, in its time scale's units (600 a second unless given). */
    points?: { timeScale?: number; in?: number; out?: number; end?: number };
  };
  text?: Pp6TextBox[];
  image?: { path: string; rect: [number, number, number, number] };
  video?: { path: string; rect: [number, number, number, number]; loop?: boolean };
  shape?: { fill: string; rect: [number, number, number, number] };
  shapes?: Pp6Shape[];
  audio?: string;
  /** A Clear cue (clears a layer), which Drashti does not run yet. */
  clear?: boolean;
  /** true: an RVTransition of type 9 for 1 s; or its type (-1 for none of its own) and seconds. */
  transition?: boolean | { type: number; seconds: number };
  /** A slide timer (RVSlideTimerCue, as the community notes on the format describe it). */
  timer?: { seconds: number; loop?: boolean };
}

const fileUrl = (path: string) => (path.startsWith('file:') ? path : pathToFileURL(path).href);

const strokeOf = (outline: Pp6TextBox['outline']) => {
  const o = typeof outline === 'object' ? outline : { color: '0 0 0 1', width: 1 };
  return `<dictionary rvXMLIvarName="stroke"><NSColor rvXMLDictionaryKey="RVShapeElementStrokeColorKey">${o.color}</NSColor><NSNumber rvXMLDictionaryKey="RVShapeElementStrokeWidthKey" hint="float">${o.width}</NSNumber></dictionary>`;
};

function textElement(t: Pp6TextBox, i: number): string {
  const [x, y, w, h] = t.rect ?? [100, 100, 1720, 880];
  const shadow = t.shadow ?? '2.000000|0 0 0 1|{2.8284, -2.8284}';
  return (
    `<RVTextElement displayName="Text ${i}" UUID="T-${i}" typeID="0" displayDelay="0" locked="false" persistent="0" fromTemplate="false" opacity="1" source="" bezelRadius="0" rotation="${t.rotation ?? 0}" drawingFill="${t.fill ? 'true' : 'false'}" drawingShadow="${shadow ? 'true' : 'false'}" drawingStroke="${t.outline ? 'true' : 'false'}" fillColor="${t.fill ?? '0 0 0 0'}" adjustsHeightToFit="${t.growToFit ? 'true' : 'false'}" verticalAlignment="${t.vertical ?? 1}" revealType="0">` +
    `<RVRect3D rvXMLIvarName="position">{${x} ${y} 0 ${w} ${h}}</RVRect3D>` +
    `<shadow rvXMLIvarName="shadow">${shadow || '0.000000|0 0 0 0.3333333432674408|{4, -4}'}</shadow>` +
    strokeOf(t.outline) +
    `<NSString rvXMLIvarName="RTFData">${b64(t.rtf)}</NSString>` +
    `</RVTextElement>`
  );
}

function shapeElement(sh: Pp6Shape, i: number): string {
  const [x, y, w, h] = sh.rect;
  const common = `UUID="SH-${i}" displayName="Shape ${i}" typeID="0" displayDelay="0" locked="false" persistent="0" fromTemplate="false" opacity="1" source="" bezelRadius="${sh.radius ?? 0}" rotation="${sh.rotation ?? 0}" drawingFill="${sh.fill ? 'true' : 'false'}" drawingShadow="${sh.shadow ? 'true' : 'false'}" drawingStroke="${sh.outline ? 'true' : 'false'}" fillColor="${sh.fill ?? '1 1 1 1'}"`;
  const inner =
    `<RVRect3D rvXMLIvarName="position">{${x} ${y} 0 ${w} ${h}}</RVRect3D>` +
    `<shadow rvXMLIvarName="shadow">0.000000|0 0 0 0.3333333432674408|{4, -4}</shadow>` +
    strokeOf(sh.outline ?? false);
  if (sh.kind === 'shape') return `<RVShapeElement ${common}>${inner}</RVShapeElement>`;
  const path = `isRectangle="${sh.kind === 'rectangle' ? 'true' : 'false'}" isCircle="${sh.kind === 'circle' ? 'true' : 'false'}" shouldClose="true" feather="0"`;
  return `<RVBezierPathElement ${common} ${path}>${inner}<array rvXMLIvarName="points"/></RVBezierPathElement>`;
}

function slide(s: Pp6SlideSpec, i: number): string {
  const elements: string[] = [];
  s.text?.forEach((t, n) => elements.push(textElement(t, n)));
  if (s.image) {
    const [x, y, w, h] = s.image.rect;
    elements.push(
      `<RVImageElement displayName="Image" UUID="I-${i}" typeID="0" displayDelay="0" locked="false" persistent="0" fromTemplate="false" opacity="1" source="${esc(fileUrl(s.image.path))}" bezelRadius="0" rotation="0" drawingFill="false" drawingShadow="false" drawingStroke="false" fillColor="1 1 1 1" scaleBehavior="0" flippedHorizontally="false" flippedVertically="false" format="JPEG image"><RVRect3D rvXMLIvarName="position">{${x} ${y} 0 ${w} ${h}}</RVRect3D></RVImageElement>`,
    );
  }
  if (s.video) {
    const [x, y, w, h] = s.video.rect;
    elements.push(
      `<RVVideoElement displayName="Video" UUID="VE-${i}" typeID="0" displayDelay="0" locked="false" persistent="0" fromTemplate="false" opacity="1" source="${esc(fileUrl(s.video.path))}" bezelRadius="0" rotation="0" drawingFill="false" drawingShadow="false" drawingStroke="false" fillColor="1 1 1 1" scaleBehavior="0" playbackBehavior="${s.video.loop ? 1 : 0}" flippedHorizontally="false" flippedVertically="false"><RVRect3D rvXMLIvarName="position">{${x} ${y} 0 ${w} ${h}}</RVRect3D></RVVideoElement>`,
    );
  }
  s.shapes?.forEach((sh, n) => elements.push(shapeElement(sh, i * 100 + n)));
  if (s.shape) {
    const [x, y, w, h] = s.shape.rect;
    elements.push(
      `<RVShapeElement displayName="Shape" UUID="S-${i}" typeID="0" displayDelay="0" locked="false" persistent="0" fromTemplate="false" opacity="1" source="" bezelRadius="12" rotation="0" drawingFill="true" drawingShadow="false" drawingStroke="false" fillColor="${s.shape.fill}"><RVRect3D rvXMLIvarName="position">{${x} ${y} 0 ${w} ${h}}</RVRect3D></RVShapeElement>`,
    );
  }
  const audioCue = s.audio
    ? `<RVAudioCue UUID="A-${i}" displayName="Placeholder audio" actionType="0" enabled="true" timeStamp="0" delayTime="0"><RVAudioElement rvXMLIvarName="element" source="${esc(fileUrl(s.audio))}" volume="0.8" playRate="1" loopBehavior="1" audioType="0" inPoint="0" outPoint="0" displayName="audio"/></RVAudioCue>`
    : '';
  const clearCue = s.clear
    ? `<RVClearCue UUID="C-${i}" displayName="Clear" actionType="2" enabled="true" timeStamp="0" delayTime="0"/>`
    : '';
  const timerCue = s.timer
    ? `<RVSlideTimerCue UUID="TC-${i}" displayName="Timer" actionType="0" enabled="true" timeStamp="0" delayTime="0" duration="${s.timer.seconds}" loopToBeginning="${s.timer.loop ? 'true' : 'false'}"/>`
    : '';
  const cues = `<array rvXMLIvarName="cues">${audioCue}${clearCue}${timerCue}</array>`;
  const background = s.background
    ? `<RVMediaCue UUID="M-${i}" displayName="Background ${i}" actionType="0" alignment="4" behavior="2" dateAdded="" delayTime="0" enabled="true" nextCueUUID="" tags="" timeStamp="0" rvXMLIvarName="backgroundMediaCue">` +
      (s.background.kind === 'video'
        ? `<RVVideoElement rvXMLIvarName="element" displayName="bg" UUID="V-${i}" source="${esc(fileUrl(s.background.path))}" scaleBehavior="${s.background.scale ?? 1}" playbackBehavior="${s.background.loop ? 1 : 0}" opacity="1" rotation="0"${pointsOf(s.background.points)}/>`
        : `<RVImageElement rvXMLIvarName="element" displayName="bg" UUID="I-bg-${i}" source="${esc(fileUrl(s.background.path))}" scaleBehavior="${s.background.scale ?? 1}" opacity="1" rotation="0"/>`) +
      `</RVMediaCue>`
    : '';
  const t = s.transition === true ? { type: 9, seconds: 1 } : s.transition;
  const transition = t
    ? `<RVTransition rvXMLIvarName="transitionInObject" transitionType="${t.type}" transitionDuration="${t.seconds}" motionEnabled="false"/>`
    : '';
  return (
    `<RVDisplaySlide backgroundColor="0 0 0 0" highlightColor="" drawingBackgroundColor="false" enabled="${s.enabled === false ? 'false' : 'true'}" socialItemCount="1" UUID="SL-${i}" chordChartPath="" label="${esc(s.label ?? '')}" notes="${esc(s.notes ?? '')}">` +
    cues +
    background +
    transition +
    `<array rvXMLIvarName="displayElements">${elements.join('')}</array>` +
    `</RVDisplaySlide>`
  );
}

export interface Pp6DocSpec {
  uuid?: string;
  width?: number;
  height?: number;
  groups: { name: string; color?: string; uuid?: string; slides: Pp6SlideSpec[] }[];
  arrangements?: { name: string; groups: string[] }[];
  /** The arrangement it is set to play in (an index into `arrangements`). */
  selectedArrangement?: number;
  ccliTitle?: string;
  ccliAuthor?: string;
  ccliArtist?: string;
}

export function pp6Presentation(spec: Pp6DocSpec): string {
  let n = 0;
  const groups = spec.groups
    .map(
      (g, gi) =>
        `<RVSlideGrouping name="${esc(g.name)}" uuid="${g.uuid ?? `G-${gi}`}" color="${g.color ?? '0 0 1 1'}" serialization-array-index="${gi}"><array rvXMLIvarName="slides">${g.slides.map((s) => slide(s, n++)).join('')}</array></RVSlideGrouping>`,
    )
    .join('');
  const arrangements = (spec.arrangements ?? [])
    .map(
      (a, ai) =>
        `<RVSongArrangement name="${esc(a.name)}" uuid="AR-${ai}" color="0 0 0 0" serialization-array-index="${ai}"><array rvXMLIvarName="groupIDs">${a.groups.map((id) => `<NSMutableString>${id}</NSMutableString>`).join('')}</array></RVSongArrangement>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n<RVPresentationDocument CCLIArtistCredits="${esc(spec.ccliArtist ?? '')}" CCLIAuthor="${esc(spec.ccliAuthor ?? '')}" CCLICopyrightYear="" CCLIDisplay="false" CCLIPublisher="" CCLISongNumber="" CCLISongTitle="${esc(spec.ccliTitle ?? '')}" backgroundColor="0 0 0 1" buildNumber="100991749" category="Presentation" chordChartPath="" docType="0" drawingBackgroundColor="false" height="${spec.height ?? 1080}" lastDateUsed="2026-01-01T00:00:00+00:00" notes="" os="1" resourcesDirectory="" selectedArrangementID="${spec.selectedArrangement === undefined ? '' : `AR-${spec.selectedArrangement}`}" usedCount="0" uuid="${spec.uuid ?? 'DOC-1'}" versionNumber="600" width="${spec.width ?? 1920}">` +
    `<RVTimeline timeOffset="0" duration="0" selectedMediaTrackIndex="0" loop="false" rvXMLIvarName="timeline"><array rvXMLIvarName="timeCues"/><array rvXMLIvarName="mediaTracks"/></RVTimeline>` +
    `<array rvXMLIvarName="groups">${groups}</array><array rvXMLIvarName="arrangements">${arrangements}</array></RVPresentationDocument>`
  );
}

/** Template documents have no uuid of their own (checked on real files). */
export function pp6Template(slides: Pp6SlideSpec[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<RVTemplateDocument versionNumber="600" docType="0" width="1920" height="1080" buildNumber="1" os="1"><array rvXMLIvarName="slides">${slides.map((s, i) => slide(s, i)).join('')}</array></RVTemplateDocument>`;
}

export type Pp6PlaylistEntry =
  /** arrangement: which of the document's arrangements the item plays (an index). */
  | { document: string; name: string; arrangement?: number }
  | { header: string }
  | { media: string; name: string }
  | { other: string };

export function pp6Playlist(
  lists: { name: string; entries: Pp6PlaylistEntry[] }[],
  folder = 'Services',
): string {
  const entry = (e: Pp6PlaylistEntry, i: number) => {
    if ('document' in e) {
      const arrangement = e.arrangement === undefined ? '' : `AR-${e.arrangement}`;
      return `<RVDocumentCue UUID="DC-${i}" displayName="${esc(e.name)}" filePath="${esc(encodeURI(e.document))}" selectedArrangementID="${arrangement}" actionType="0" enabled="false" timeStamp="0" delayTime="0"/>`;
    }
    if ('header' in e)
      return `<RVHeaderCue UUID="H-${i}" displayName="${esc(e.header)}" actionType="0" enabled="true" color="1 0.5 0 1"/>`;
    if ('media' in e) {
      return `<RVMediaCue UUID="MC-${i}" displayName="${esc(e.name)}" actionType="0" enabled="true"><RVVideoElement rvXMLIvarName="element" source="${esc(fileUrl(e.media))}" scaleBehavior="0"/></RVMediaCue>`;
    }
    return `<${e.other} UUID="O-${i}" displayName="Something else"/>`;
  };
  const playlists = lists
    .map(
      (l, li) =>
        `<RVPlaylistNode displayName="${esc(l.name)}" UUID="PL-${li}" smartDirectoryURL="" modifiedDate="" type="3" isExpanded="true" hotFolderType="2"><array rvXMLIvarName="children">${l.entries.map(entry).join('')}</array><array rvXMLIvarName="events"/></RVPlaylistNode>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n<RVPlaylistDocument versionNumber="600" os="1" buildNumber="100991749">` +
    `<RVPlaylistNode displayName="root" UUID="ROOT" smartDirectoryURL="" modifiedDate="" type="0" isExpanded="false" hotFolderType="2" rvXMLIvarName="rootNode"><array rvXMLIvarName="children">` +
    `<RVPlaylistNode displayName="${esc(folder)}" UUID="F-1" smartDirectoryURL="" modifiedDate="" type="2" isExpanded="true" hotFolderType="2"><array rvXMLIvarName="children">${playlists}</array><array rvXMLIvarName="events"/></RVPlaylistNode>` +
    `</array><array rvXMLIvarName="events"/></RVPlaylistNode><array rvXMLIvarName="deletions"/><array rvXMLIvarName="tags"/></RVPlaylistDocument>`
  );
}
