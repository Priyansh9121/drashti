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

const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');

export interface Pp6TextBox {
  rtf: string;
  rect?: [number, number, number, number];
  fill?: string;
  vertical?: 0 | 1 | 2;
  outline?: boolean;
}

export interface Pp6SlideSpec {
  label?: string;
  notes?: string;
  enabled?: boolean;
  background?: { path: string; kind: 'image' | 'video'; loop?: boolean; scale?: number };
  text?: Pp6TextBox[];
  image?: { path: string; rect: [number, number, number, number] };
  shape?: { fill: string; rect: [number, number, number, number] };
  audio?: string;
  transition?: boolean;
}

const fileUrl = (path: string) => (path.startsWith('file:') ? path : pathToFileURL(path).href);

function textElement(t: Pp6TextBox, i: number): string {
  const [x, y, w, h] = t.rect ?? [100, 100, 1720, 880];
  return (
    `<RVTextElement displayName="Text ${i}" UUID="T-${i}" typeID="0" displayDelay="0" locked="false" persistent="0" fromTemplate="false" opacity="1" source="" bezelRadius="0" rotation="0" drawingFill="${t.fill ? 'true' : 'false'}" drawingShadow="true" drawingStroke="${t.outline ? 'true' : 'false'}" fillColor="${t.fill ?? '0 0 0 0'}" adjustsHeightToFit="false" verticalAlignment="${t.vertical ?? 1}" revealType="0">` +
    `<RVRect3D rvXMLIvarName="position">{${x} ${y} 0 ${w} ${h}}</RVRect3D>` +
    `<shadow rvXMLIvarName="shadow">2.000000|0 0 0 1|{2.8284, -2.8284}</shadow>` +
    `<dictionary rvXMLIvarName="stroke"><NSColor rvXMLDictionaryKey="RVShapeElementStrokeColorKey">0 0 0 1</NSColor><NSNumber rvXMLDictionaryKey="RVShapeElementStrokeWidthKey" hint="float">1</NSNumber></dictionary>` +
    `<NSString rvXMLIvarName="RTFData">${b64(t.rtf)}</NSString>` +
    `</RVTextElement>`
  );
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
  if (s.shape) {
    const [x, y, w, h] = s.shape.rect;
    elements.push(
      `<RVShapeElement displayName="Shape" UUID="S-${i}" typeID="0" displayDelay="0" locked="false" persistent="0" fromTemplate="false" opacity="1" source="" bezelRadius="12" rotation="0" drawingFill="true" drawingShadow="false" drawingStroke="false" fillColor="${s.shape.fill}"><RVRect3D rvXMLIvarName="position">{${x} ${y} 0 ${w} ${h}}</RVRect3D></RVShapeElement>`,
    );
  }
  const cues = s.audio
    ? `<array rvXMLIvarName="cues"><RVAudioCue UUID="A-${i}" displayName="Placeholder audio" actionType="0" enabled="true" timeStamp="0" delayTime="0"><RVAudioElement rvXMLIvarName="element" source="${esc(fileUrl(s.audio))}" volume="0.8" playRate="1" loopBehavior="1" audioType="0" inPoint="0" outPoint="0" displayName="audio"/></RVAudioCue></array>`
    : '<array rvXMLIvarName="cues"/>';
  const background = s.background
    ? `<RVMediaCue UUID="M-${i}" displayName="Background ${i}" actionType="0" alignment="4" behavior="2" dateAdded="" delayTime="0" enabled="true" nextCueUUID="" tags="" timeStamp="0" rvXMLIvarName="backgroundMediaCue">` +
      (s.background.kind === 'video'
        ? `<RVVideoElement rvXMLIvarName="element" displayName="bg" UUID="V-${i}" source="${esc(fileUrl(s.background.path))}" scaleBehavior="${s.background.scale ?? 1}" playbackBehavior="${s.background.loop ? 1 : 0}" opacity="1" rotation="0"/>`
        : `<RVImageElement rvXMLIvarName="element" displayName="bg" UUID="I-bg-${i}" source="${esc(fileUrl(s.background.path))}" scaleBehavior="${s.background.scale ?? 1}" opacity="1" rotation="0"/>`) +
      `</RVMediaCue>`
    : '';
  const transition = s.transition
    ? `<RVTransition rvXMLIvarName="transitionInObject" transitionType="9" transitionDuration="1.0" motionEnabled="false"/>`
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
  ccliTitle?: string;
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
    `<?xml version="1.0" encoding="utf-8"?>\n<RVPresentationDocument CCLIArtistCredits="" CCLIAuthor="" CCLICopyrightYear="" CCLIDisplay="false" CCLIPublisher="" CCLISongNumber="" CCLISongTitle="${esc(spec.ccliTitle ?? '')}" backgroundColor="0 0 0 1" buildNumber="100991749" category="Presentation" chordChartPath="" docType="0" drawingBackgroundColor="false" height="${spec.height ?? 1080}" lastDateUsed="2026-01-01T00:00:00+00:00" notes="" os="1" resourcesDirectory="" selectedArrangementID="" usedCount="0" uuid="${spec.uuid ?? 'DOC-1'}" versionNumber="600" width="${spec.width ?? 1920}">` +
    `<RVTimeline timeOffset="0" duration="0" selectedMediaTrackIndex="0" loop="false" rvXMLIvarName="timeline"><array rvXMLIvarName="timeCues"/><array rvXMLIvarName="mediaTracks"/></RVTimeline>` +
    `<array rvXMLIvarName="groups">${groups}</array><array rvXMLIvarName="arrangements">${arrangements}</array></RVPresentationDocument>`
  );
}

/** Template documents have no uuid of their own (checked on real files). */
export function pp6Template(slides: Pp6SlideSpec[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<RVTemplateDocument versionNumber="600" docType="0" width="1920" height="1080" buildNumber="1" os="1"><array rvXMLIvarName="slides">${slides.map((s, i) => slide(s, i)).join('')}</array></RVTemplateDocument>`;
}

export type Pp6PlaylistEntry =
  | { document: string; name: string }
  | { header: string }
  | { media: string; name: string }
  | { other: string };

export function pp6Playlist(
  lists: { name: string; entries: Pp6PlaylistEntry[] }[],
  folder = 'Services',
): string {
  const entry = (e: Pp6PlaylistEntry, i: number) => {
    if ('document' in e) {
      return `<RVDocumentCue UUID="DC-${i}" displayName="${esc(e.name)}" filePath="${esc(encodeURI(e.document))}" selectedArrangementID="" actionType="0" enabled="false" timeStamp="0" delayTime="0"/>`;
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
