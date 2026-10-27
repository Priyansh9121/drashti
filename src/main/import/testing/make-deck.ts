import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeZip } from './zip-writer';

/*
 * Tests only: C1's trial decks (Session 54, C1's make-decks.mjs, assister/session-54-deck-trial.md), made by hand,
 * with no Office: a placeholder deck whose PresentationML is written as PowerPoint 16 writes it (ECMA-376 Part 1
 * §19.5 timing, [MS-PPTX] p14 media and transitions). Every word is made up, plus the placeholder "નમૂના" and
 * "नमूना"; its pictures, videos and sounds are generated (makeDeckMedia, with FFmpeg) or placeholder bytes.
 *
 * The trial deck has 6 slides, the last one hidden: a different transition on each (Fade 0.7 s, Push 1.0 s with a
 * chime, Wipe 0.8 s, Cover 1.0 s, Vortex 1.5 s, Split 0.6 s); three bullets one click at a time and an exit on a
 * fourth; a caption that comes in by itself; a motion path; a click that starts a chain (A flies in, B fades in
 * "after previous" 0.25 s later, then C); a star that spins until the slide ends; a video that starts by itself,
 * trimmed 1 s at each end, looping, at 80 %; a video in the click sequence at 50 % with a 0.5 s fade in; a sound
 * that starts by itself; speaker notes on every slide. `twenty` repeats the shown slides four times (20 shown).
 */

/** The deck's media files, by name. */
export interface DeckMediaFiles {
  pic1: Buffer;
  pic2: Buffer;
  clip1: Buffer;
  clip2: Buffer;
  tone: Buffer;
  chime: Buffer;
  speaker: Buffer;
  poster1: Buffer;
  poster2: Buffer;
}

type MediaKey = keyof DeckMediaFiles;
const EXT: Record<MediaKey, string> = {
  pic1: 'png',
  pic2: 'png',
  clip1: 'mp4',
  clip2: 'mp4',
  tone: 'm4a',
  chime: 'wav',
  speaker: 'png',
  poster1: 'png',
  poster2: 'png',
};

/** Placeholder bytes for every media file: for tests that read the deck's XML and never play its media. */
export function placeholderDeckMedia(): DeckMediaFiles {
  const files = {} as DeckMediaFiles;
  for (const key of Object.keys(EXT) as MediaKey[]) files[key] = Buffer.from(`placeholder ${key}`);
  return files;
}

/**
 * The trial's media made by FFmpeg into `dir` (once): two 5 s videos (a test pattern, a white bar as wide as its
 * time is far, and a tone), pictures, a 6 s tone and a chime. Nothing real.
 */
export function makeDeckMedia(ffmpeg: string, dir: string): DeckMediaFiles {
  mkdirSync(dir, { recursive: true });
  const ff = (args: string[]) => {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
  };
  const make = (key: MediaKey, args: (path: string) => string[]) => {
    const path = join(dir, `${key}.${EXT[key]}`);
    if (!existsSync(path)) ff(args(path));
    return path;
  };
  const clip = (hue: number, tone: number) => (path: string) => [
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=640x360:r=30:d=5,hue=h=${String(hue)},drawbox=x=0:y=ih-40:w=iw*t/5:h=40:color=white:t=fill`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${String(tone)}:sample_rate=48000:duration=5`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-shortest',
    '-movflags',
    '+faststart',
    path,
  ];
  const paths = {
    pic1: make('pic1', (p) => ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1', '-frames:v', '1', p]),
    pic2: make('pic2', (p) => [
      '-f',
      'lavfi',
      '-i',
      'gradients=s=640x360:c0=0x3E63DD:c1=0xE5484D:x0=0:y0=0:x1=640:y1=360:d=1',
      '-frames:v',
      '1',
      p,
    ]),
    clip1: make('clip1', clip(0, 440)),
    clip2: make('clip2', clip(140, 550)),
    tone: make('tone', (p) => [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=660:sample_rate=48000:duration=6',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      p,
    ]),
    chime: make('chime', (p) => [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:sample_rate=44100:duration=0.6',
      '-c:a',
      'pcm_s16le',
      p,
    ]),
    speaker: make('speaker', (p) => [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x30A46C:s=128x128:d=1',
      '-frames:v',
      '1',
      p,
    ]),
  };
  const poster1 = make('poster1', (p) => ['-ss', '1', '-i', paths.clip1, '-frames:v', '1', p]);
  const poster2 = make('poster2', (p) => ['-i', paths.clip2, '-frames:v', '1', p]);
  const read = (p: string) => readFileSync(p);
  return {
    pic1: read(paths.pic1),
    pic2: read(paths.pic2),
    clip1: read(paths.clip1),
    clip2: read(paths.clip2),
    tone: read(paths.tone),
    chime: read(paths.chime),
    speaker: read(paths.speaker),
    poster1: read(poster1),
    poster2: read(poster2),
  };
}

// ---- PresentationML -------------------------------------------------------------------------------

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_MEDIA = 'http://schemas.microsoft.com/office/2007/relationships/media';
const esc = (t: string) =>
  t.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
const rels = (list: { id: string; type: string; target: string; external?: boolean }[]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${r.type.startsWith('http') ? r.type : `${REL}/${r.type}`}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`,
    )
    .join('')}</Relationships>`;
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const CLR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Placeholder"><a:themeElements><a:clrScheme name="Placeholder"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="3E63DD"/></a:accent1><a:accent2><a:srgbClr val="E5484D"/></a:accent2><a:accent3><a:srgbClr val="30A46C"/></a:accent3><a:accent4><a:srgbClr val="F5D90A"/></a:accent4><a:accent5><a:srgbClr val="8E4EC6"/></a:accent5><a:accent6><a:srgbClr val="F76808"/></a:accent6><a:hlink><a:srgbClr val="0091FF"/></a:hlink><a:folHlink><a:srgbClr val="8E4EC6"/></a:folHlink></a:clrScheme><a:fontScheme name="Placeholder"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Placeholder"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${['6350', '12700', '19050'].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const MASTER = `${XML}<p:sldMaster ${NS}><p:cSld><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const LAYOUT = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const NOTES_MASTER = `${XML}<p:notesMaster ${NS}><p:cSld><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/></p:notesMaster>`;

/** 16:9, 13.33 in, in EMU. */
export const DECK_WIDTH = 12_192_000;
export const DECK_HEIGHT = 6_858_000;
const IN = 914_400;

interface Run {
  text: string;
  size?: number;
  bold?: boolean;
  color?: string;
  lang?: string;
  font?: string;
  align?: 'l' | 'ctr';
  bullet?: boolean;
}
interface Box {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface WordsShape extends Box {
  type: 'text' | 'shape';
  geom?: string;
  fill?: string;
  paras?: Run[];
  anchor?: string;
}
interface PictureShape extends Box {
  type: 'pic';
  media: MediaKey;
}
interface MediaShape extends Box {
  type: 'video' | 'audio';
  media: MediaKey;
  poster: MediaKey;
  trim?: { st: number; end: number };
  loop?: boolean;
  volume?: number;
  fadeIn?: number;
  hideIcon?: boolean;
  /** A sound that plays on across this many slides (Play Across Slides; left out, its own slide). */
  acrossSlides?: number;
  /** Linked, not embedded: the path or file URL the deck names (TargetMode="External"), its poster still inside. */
  link?: string;
}
type Shape = WordsShape | PictureShape | MediaShape;
const isMedia = (s: Shape): s is MediaShape => s.type === 'video' || s.type === 'audio';
const isWords = (s: Shape): s is WordsShape => s.type === 'text' || s.type === 'shape';

type EffectKind = 'fade' | 'wipe' | 'fly' | 'exit-fade' | 'spin' | 'path' | 'play';
interface Effect {
  kind: EffectKind;
  target: number;
  para?: number;
  dur: number;
  delay?: number;
  start: 'click' | 'with' | 'after';
  repeat?: 'indefinite';
  /** It repeats until the next click (Repeat: Until Next Click), not until the slide ends. */
  untilNextClick?: boolean;
  path?: string;
}

export interface TestDeckSlide {
  key: string;
  bg: string;
  hidden?: boolean;
  transition: { kind: string; dur: number; sound?: MediaKey };
  notes: string;
  shapes: Shape[];
  effects: Effect[];
}

function run(r: Run): string {
  const lang = r.lang ?? 'en-US';
  const fonts = r.font
    ? lang === 'en-US'
      ? `<a:latin typeface="${esc(r.font)}"/>`
      : `<a:latin typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/>`
    : '';
  return `<a:r><a:rPr lang="${lang}" sz="${String((r.size ?? 32) * 100)}" b="${r.bold ? '1' : '0'}" dirty="0"><a:solidFill><a:srgbClr val="${r.color ?? 'FFFFFF'}"/></a:solidFill>${fonts}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
}
const para = (p: Run) =>
  `<a:p><a:pPr algn="${p.align ?? 'l'}"${p.bullet ? ' marL="457200" indent="-457200"' : ''}>${p.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>'}</a:pPr>${run(p)}</a:p>`;
const xfrm = (s: Box) =>
  `<a:xfrm><a:off x="${String(Math.round(s.x))}" y="${String(Math.round(s.y))}"/><a:ext cx="${String(Math.round(s.w))}" cy="${String(Math.round(s.h))}"/></a:xfrm>`;

function shapeXml(
  shape: Shape,
  relOf: (key: MediaKey, kind: string) => string,
  linkOf: (target: string, kind: string) => string,
): string {
  if (isWords(shape)) {
    const fill = shape.fill ? `<a:solidFill><a:srgbClr val="${shape.fill}"/></a:solidFill>` : '<a:noFill/>';
    const body = shape.paras
      ? `<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${shape.anchor ?? 't'}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${shape.paras.map(para).join('')}</p:txBody>`
      : '';
    return `<p:sp><p:nvSpPr><p:cNvPr id="${String(shape.id)}" name="${esc(shape.name)}"/><p:cNvSpPr${shape.type === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(shape)}<a:prstGeom prst="${shape.geom ?? 'rect'}"><a:avLst/></a:prstGeom>${fill}</p:spPr>${body}</p:sp>`;
  }
  if (!isMedia(shape))
    return `<p:pic><p:nvPicPr><p:cNvPr id="${String(shape.id)}" name="${esc(shape.name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relOf(shape.media, 'image')}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(shape)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const link = shape.link ? linkOf(shape.link, shape.type) : relOf(shape.media, shape.type);
  const embed = shape.link ? null : relOf(shape.media, 'media');
  const poster = relOf(shape.poster, 'image');
  const trim = shape.trim ? `<p14:trim st="${String(shape.trim.st)}" end="${String(shape.trim.end)}"/>` : '';
  const fade = shape.fadeIn ? `<p14:fade in="${String(shape.fadeIn)}"/>` : '';
  const p14 = embed
    ? `<p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="${P14}" r:embed="${embed}">${fade}${trim}</p14:media></p:ext></p:extLst>`
    : '';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${String(shape.id)}" name="${esc(shape.name)}"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr><a:${shape.type}File r:link="${link}"/>${p14}</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${poster}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(shape)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/** The slide's timing: click groups, each a chain of sub-groups ("with" or "after previous"). */
function timingXml(slide: TestDeckSlide): string {
  let id = 0;
  const next = () => ++id;
  const effects = slide.effects;
  const mediaShapes = slide.shapes.filter(isMedia);
  if (effects.length === 0 && mediaShapes.length === 0) return '';
  const groups: { auto: boolean; subs: { effects: Effect[] }[] }[] = [];
  for (const e of effects) {
    if (e.start === 'click' || groups.length === 0) groups.push({ auto: e.start !== 'click', subs: [] });
    const g = groups[groups.length - 1];
    if (!g) continue;
    if (g.subs.length === 0 || e.start === 'after') g.subs.push({ effects: [] });
    g.subs[g.subs.length - 1]?.effects.push(e);
  }
  const endOf = (e: Effect) => (e.repeat === 'indefinite' ? 0 : (e.delay ?? 0) + e.dur);
  const tgt = (e: Effect) =>
    e.para === undefined
      ? `<p:spTgt spid="${String(e.target)}"/>`
      : `<p:spTgt spid="${String(e.target)}"><p:txEl><p:pRg st="${String(e.para)}" end="${String(e.para)}"/></p:txEl></p:spTgt>`;
  const setVis = (e: Effect, val: string, delay: number) =>
    `<p:set><p:cBhvr><p:cTn id="${String(next())}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${String(delay)}"/></p:stCondLst></p:cTn><p:tgtEl>${tgt(e)}</p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
  const anim = (e: Effect, attr: string, from: string, to: string) =>
    `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${String(next())}" dur="${String(e.dur)}" fill="hold"/><p:tgtEl>${tgt(e)}</p:tgtEl><p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
  const behaviours = (e: Effect) => {
    switch (e.kind) {
      case 'fade':
        return `${setVis(e, 'visible', 0)}<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${String(next())}" dur="${String(e.dur)}"/><p:tgtEl>${tgt(e)}</p:tgtEl></p:cBhvr></p:animEffect>`;
      case 'wipe':
        return `${setVis(e, 'visible', 0)}<p:animEffect transition="in" filter="wipe(left)"><p:cBhvr><p:cTn id="${String(next())}" dur="${String(e.dur)}"/><p:tgtEl>${tgt(e)}</p:tgtEl></p:cBhvr></p:animEffect>`;
      case 'fly':
        return `${setVis(e, 'visible', 0)}${anim(e, 'ppt_x', '#ppt_x', '#ppt_x')}${anim(e, 'ppt_y', '1+#ppt_h/2', '#ppt_y')}`;
      case 'exit-fade':
        return `<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="${String(next())}" dur="${String(e.dur)}"/><p:tgtEl>${tgt(e)}</p:tgtEl></p:cBhvr></p:animEffect>${setVis(e, 'hidden', e.dur - 1)}`;
      case 'spin':
        return `<p:animRot by="21600000"><p:cBhvr><p:cTn id="${String(next())}" dur="${String(e.dur)}" fill="hold"/><p:tgtEl>${tgt(e)}</p:tgtEl><p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
      case 'path':
        return `<p:animMotion origin="layout" path="${e.path ?? ''}" pathEditMode="relative" rAng="0" ptsTypes="AA"><p:cBhvr><p:cTn id="${String(next())}" dur="${String(e.dur)}" fill="hold"/><p:tgtEl>${tgt(e)}</p:tgtEl><p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:rCtr x="0" y="0"/></p:animMotion>`;
      case 'play':
        return `<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="${String(next())}" dur="${String(e.dur)}" fill="hold"/><p:tgtEl>${tgt(e)}</p:tgtEl></p:cBhvr></p:cmd>`;
    }
  };
  const PRESET: Record<EffectKind, [string, string, string]> = {
    fade: ['10', 'entr', '0'],
    wipe: ['22', 'entr', '8'],
    fly: ['2', 'entr', '4'],
    'exit-fade': ['10', 'exit', '0'],
    spin: ['8', 'emph', '0'],
    path: ['0', 'path', '0'],
    play: ['1', 'mediacall', '0'],
  };
  const nodeType = (e: Effect, first: boolean) =>
    first && e.start === 'click'
      ? 'clickEffect'
      : e.start === 'after'
        ? 'afterEffect'
        : e.start === 'with'
          ? 'withEffect'
          : 'clickEffect';
  const effectXml = (e: Effect, first: boolean) => {
    const [presetID, presetClass, presetSubtype] = PRESET[e.kind];
    const cTn = next();
    const grp = presetClass === 'mediacall' ? '' : ' grpId="0"';
    const extra = `${e.repeat ? ' repeatCount="indefinite"' : ''}${e.kind === 'path' ? ' accel="50000" decel="50000"' : ''}`;
    const untilClick = e.untilNextClick
      ? '<p:endCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>'
      : '';
    return `<p:par><p:cTn id="${String(cTn)}" presetID="${presetID}" presetClass="${presetClass}" presetSubtype="${presetSubtype}"${extra} fill="hold"${grp} nodeType="${nodeType(e, first)}"><p:stCondLst><p:cond delay="${String(e.delay ?? 0)}"/></p:stCondLst>${untilClick}<p:childTnLst>${behaviours(e)}</p:childTnLst></p:cTn></p:par>`;
  };
  const root = next();
  const mainSeq = next();
  const groupXml = groups
    .map((g) => {
      const gid = next();
      let at = 0;
      const subs = g.subs
        .map((sub, si) => {
          const sid = next();
          const start = at;
          const body = sub.effects.map((e, ei) => effectXml(e, si === 0 && ei === 0)).join('');
          at = start + Math.max(...sub.effects.map(endOf));
          return `<p:par><p:cTn id="${String(sid)}" fill="hold"><p:stCondLst><p:cond delay="${String(start)}"/></p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`;
        })
        .join('');
      const cond = g.auto
        ? `<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="${String(mainSeq)}"/></p:cond>`
        : '<p:cond delay="indefinite"/>';
      return `<p:par><p:cTn id="${String(gid)}" fill="hold"><p:stCondLst>${cond}</p:stCondLst><p:childTnLst>${subs}</p:childTnLst></p:cTn></p:par>`;
    })
    .join('');
  const seq =
    groups.length > 0
      ? `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${String(mainSeq)}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${groupXml}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`
      : '';
  const mediaNodes = mediaShapes
    .map((s) => {
      const tn = next();
      const repeat = s.loop ? ' repeatCount="indefinite"' : '';
      const extra =
        s.type === 'audio'
          ? ` numSld="${String(s.acrossSlides ?? 1)}"${s.hideIcon ? ' showWhenStopped="0"' : ''}`
          : '';
      const endCond =
        s.type === 'audio'
          ? '<p:endCondLst><p:cond evt="onStopAudio" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>'
          : '';
      return `<p:${s.type}><p:cMediaNode vol="${String((s.volume ?? 100) * 1000)}"${extra}><p:cTn id="${String(tn)}"${repeat} fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>${endCond}</p:cTn><p:tgtEl><p:spTgt spid="${String(s.id)}"/></p:tgtEl></p:cMediaNode></p:${s.type}>`;
    })
    .join('');
  const bld: string[] = [];
  for (const s of slide.shapes) {
    if (!isWords(s)) continue;
    const mine = effects.filter((e) => e.target === s.id && e.kind !== 'play');
    if (mine.length === 0) continue;
    const byPara = mine.some((e) => e.para !== undefined);
    bld.push(
      `<p:bldP spid="${String(s.id)}" grpId="0"${byPara ? ' build="p"' : ''}${s.fill ? ' animBg="1"' : ''}/>`,
    );
  }
  return `<p:timing><p:tnLst><p:par><p:cTn id="${String(root)}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${seq}${mediaNodes}</p:childTnLst></p:cTn></p:par></p:tnLst>${bld.length > 0 ? `<p:bldLst>${bld.join('')}</p:bldLst>` : ''}</p:timing>`;
}

const TRANSITIONS: Record<string, string> = {
  fade: '<p:fade/>',
  push: '<p:push dir="u"/>',
  wipe: '<p:wipe dir="r"/>',
  cover: '<p:cover dir="l"/>',
  split: '<p:split orient="vert" dir="out"/>',
  zoom: '<p:zoom/>',
};

function transitionXml(
  t: TestDeckSlide['transition'],
  relOf: (key: MediaKey, kind: string) => string,
): string {
  const sound = t.sound
    ? `<p:sndAc><p:stSnd><p:snd r:embed="${relOf(t.sound, 'audio')}" name="${esc(t.sound)}.wav"/></p:stSnd></p:sndAc>`
    : '';
  // p14-only transitions (Vortex) fall back to a fade for readers that do not know them.
  const choice =
    t.kind === 'vortex' ? `<p14:vortex xmlns:p14="${P14}" dir="r"/>` : (TRANSITIONS[t.kind] ?? '');
  const fallback = t.kind === 'vortex' ? (TRANSITIONS['fade'] ?? '') : (TRANSITIONS[t.kind] ?? '');
  const spd = t.dur <= 500 ? 'fast' : t.dur <= 750 ? 'med' : 'slow';
  return `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${P14}" Requires="p14"><p:transition spd="${spd}" p14:dur="${String(t.dur)}">${choice}${sound}</p:transition></mc:Choice><mc:Fallback><p:transition spd="${spd}">${fallback}${sound}</p:transition></mc:Fallback></mc:AlternateContent>`;
}

function notesXml(notes: string): string {
  const paras = notes
    .split('\n')
    .map((line) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(line)}</a:t></a:r></a:p>`)
    .join('');
  return `${XML}<p:notes ${NS}><p:cSld><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

// ---- the trial deck's slides ---------------------------------------------------------------------

const title = (id: number, text: string): Shape => ({
  id,
  type: 'text',
  name: `Title ${String(id)}`,
  x: 0.6 * IN,
  y: 0.35 * IN,
  w: DECK_WIDTH - 1.2 * IN,
  h: 1.0 * IN,
  paras: [{ text, size: 40, bold: true, align: 'l' }],
});

export const TRIAL_SLIDES: readonly TestDeckSlide[] = [
  {
    key: 'build',
    bg: '1B2A4A',
    transition: { kind: 'fade', dur: 700 },
    notes: 'Placeholder notes, slide one: three bullets come in one click at a time.',
    shapes: [
      title(2, 'Velora tamsin, one at a time'),
      {
        id: 3,
        type: 'text',
        name: 'Bullets',
        x: 0.8 * IN,
        y: 1.6 * IN,
        w: 7.2 * IN,
        h: 3.2 * IN,
        paras: [
          { text: 'Orvel dun praxis', size: 32, bullet: true },
          { text: 'Tamber lo vint', size: 32, bullet: true },
          { text: 'Quessa marion', size: 32, bullet: true },
        ],
      },
      {
        id: 4,
        type: 'text',
        name: 'Scripts',
        x: 8.2 * IN,
        y: 1.6 * IN,
        w: 4.6 * IN,
        h: 4.6 * IN,
        paras: [
          { text: 'નમૂના', size: 60, lang: 'gu-IN', font: 'Kohinoor Gujarati', align: 'ctr' },
          { text: 'नमूना', size: 60, lang: 'hi-IN', font: 'Mangal', align: 'ctr' },
        ],
      },
      {
        id: 5,
        type: 'text',
        name: 'Goodbye line',
        x: 0.8 * IN,
        y: 5.9 * IN,
        w: 7.2 * IN,
        h: 0.8 * IN,
        paras: [{ text: 'Sennet ilo (goes on the fourth click)', size: 24, color: 'F5D90A' }],
      },
    ],
    effects: [
      { kind: 'fade', target: 3, para: 0, dur: 500, start: 'click' },
      { kind: 'fade', target: 3, para: 1, dur: 500, start: 'click' },
      { kind: 'fade', target: 3, para: 2, dur: 500, start: 'click' },
      { kind: 'exit-fade', target: 5, dur: 500, start: 'click' },
    ],
  },
  {
    key: 'chain',
    bg: '0F3D2E',
    transition: { kind: 'push', dur: 1000, sound: 'chime' },
    notes: 'Placeholder notes, slide two: a motion path, then a chain that runs on by itself.',
    shapes: [
      title(2, 'Pellum arc and its chain'),
      {
        id: 3,
        type: 'pic',
        name: 'Pattern',
        media: 'pic1',
        x: 0.8 * IN,
        y: 1.7 * IN,
        w: 3.2 * IN,
        h: 1.8 * IN,
      },
      {
        id: 4,
        type: 'shape',
        name: 'Disc A',
        geom: 'ellipse',
        fill: 'E5484D',
        x: 1.0 * IN,
        y: 4.4 * IN,
        w: 1.6 * IN,
        h: 1.6 * IN,
        paras: [{ text: 'A', size: 40, align: 'ctr' }],
        anchor: 'ctr',
      },
      {
        id: 5,
        type: 'shape',
        name: 'Disc B',
        geom: 'ellipse',
        fill: '3E63DD',
        x: 3.4 * IN,
        y: 4.4 * IN,
        w: 1.6 * IN,
        h: 1.6 * IN,
        paras: [{ text: 'B', size: 40, align: 'ctr' }],
        anchor: 'ctr',
      },
      {
        id: 6,
        type: 'shape',
        name: 'Disc C',
        geom: 'ellipse',
        fill: '8E4EC6',
        x: 5.8 * IN,
        y: 4.4 * IN,
        w: 1.6 * IN,
        h: 1.6 * IN,
        paras: [{ text: 'C', size: 40, align: 'ctr' }],
        anchor: 'ctr',
      },
      {
        id: 7,
        type: 'text',
        name: 'Caption',
        x: 8.2 * IN,
        y: 1.7 * IN,
        w: 4.4 * IN,
        h: 1.0 * IN,
        paras: [{ text: 'Comes in by itself', size: 24 }],
      },
    ],
    effects: [
      { kind: 'wipe', target: 7, dur: 600, start: 'after', delay: 300 },
      { kind: 'path', target: 3, dur: 2000, start: 'click', path: 'M 0 0 C 0.1 -0.15 0.3 -0.15 0.45 0 E' },
      { kind: 'fly', target: 4, dur: 500, start: 'click' },
      { kind: 'fade', target: 5, dur: 500, start: 'after', delay: 250 },
      { kind: 'fly', target: 6, dur: 500, start: 'after' },
    ],
  },
  {
    key: 'loop',
    bg: '3B1F2B',
    transition: { kind: 'wipe', dur: 800 },
    notes: 'Placeholder notes, slide three: the star spins until the slide ends.',
    shapes: [
      title(2, 'Corvin star keeps turning'),
      {
        id: 3,
        type: 'shape',
        name: 'Star',
        geom: 'star5',
        fill: 'F5D90A',
        x: 4.9 * IN,
        y: 1.8 * IN,
        w: 3.4 * IN,
        h: 3.4 * IN,
      },
      {
        id: 4,
        type: 'text',
        name: 'Line',
        x: 0.8 * IN,
        y: 5.6 * IN,
        w: 11.0 * IN,
        h: 0.9 * IN,
        paras: [{ text: 'Dravo lune passet, on a click', size: 28, align: 'ctr' }],
      },
    ],
    effects: [
      { kind: 'spin', target: 3, dur: 2000, start: 'with', repeat: 'indefinite' },
      { kind: 'fade', target: 4, dur: 700, start: 'click' },
    ],
  },
  {
    key: 'video-auto',
    bg: '111111',
    transition: { kind: 'cover', dur: 1000 },
    notes:
      'Placeholder notes, slide four: the video starts by itself, trimmed 1 s at each end, and loops at 80%.',
    shapes: [
      title(2, 'Moving tessel plays by itself'),
      {
        id: 3,
        type: 'video',
        name: 'Clip one',
        media: 'clip1',
        poster: 'poster1',
        x: 2.4 * IN,
        y: 1.5 * IN,
        w: 8.53 * IN,
        h: 4.8 * IN,
        trim: { st: 1000, end: 1000 },
        loop: true,
        volume: 80,
      },
    ],
    effects: [{ kind: 'play', target: 3, dur: 3000, start: 'after' }],
  },
  {
    key: 'video-click',
    bg: '2A2A12',
    transition: { kind: 'vortex', dur: 1500 },
    notes:
      'Placeholder notes, slide five: a tone starts by itself; the video waits for a click, at 50% with a fade in.',
    shapes: [
      title(2, 'Halden clip waits for a click'),
      {
        id: 3,
        type: 'video',
        name: 'Clip two',
        media: 'clip2',
        poster: 'poster2',
        x: 0.8 * IN,
        y: 1.6 * IN,
        w: 7.11 * IN,
        h: 4.0 * IN,
        volume: 50,
        fadeIn: 500,
      },
      {
        id: 4,
        type: 'audio',
        name: 'Tone',
        media: 'tone',
        poster: 'speaker',
        x: 9.6 * IN,
        y: 2.4 * IN,
        w: 1.0 * IN,
        h: 1.0 * IN,
        volume: 100,
      },
      {
        id: 5,
        type: 'pic',
        name: 'Gradient',
        media: 'pic2',
        x: 8.4 * IN,
        y: 4.0 * IN,
        w: 3.6 * IN,
        h: 2.0 * IN,
      },
    ],
    effects: [
      { kind: 'play', target: 4, dur: 6000, start: 'after' },
      { kind: 'play', target: 3, dur: 5000, start: 'click' },
    ],
  },
  {
    key: 'hidden',
    bg: '444444',
    hidden: true,
    transition: { kind: 'split', dur: 600 },
    notes: 'Placeholder notes, the hidden slide.',
    shapes: [title(2, 'Hidden: Marrow quill')],
    effects: [],
  },
];

/** The trial's slides four times over (20 shown), each title numbered, and the hidden one last. */
export function twentySlides(): TestDeckSlide[] {
  const shown = TRIAL_SLIDES.filter((s) => !s.hidden);
  const out = [...shown, ...shown, ...shown, ...shown].map((s, i) => ({
    ...s,
    shapes: s.shapes.map((x) =>
      x.id === 2 && isWords(x) && x.paras?.[0]
        ? { ...x, paras: [{ ...x.paras[0], text: `${x.paras[0].text} (${String(i + 1)})` }] }
        : x,
    ),
  }));
  const hidden = TRIAL_SLIDES.find((s) => s.hidden);
  if (hidden) out.push(hidden);
  return out;
}

/** A deck of these slides, as PowerPoint writes one. */
export function makeTestDeck(slides: readonly TestDeckSlide[], media: DeckMediaFiles): Buffer {
  const files: { name: string; data: string | Buffer; deflate: boolean }[] = [];
  const mediaPart = new Map<MediaKey, string>();
  const partFor = (key: MediaKey) => {
    let name = mediaPart.get(key);
    if (!name) {
      const ext = EXT[key];
      name = `${ext === 'png' ? 'image' : 'media'}${String(mediaPart.size + 1)}.${ext}`;
      mediaPart.set(key, name);
      files.push({ name: `ppt/media/${name}`, data: media[key], deflate: false });
    }
    return name;
  };
  slides.forEach((slide, k) => {
    const n = String(k + 1);
    const slideRels: { id: string; type: string; target: string; external?: boolean }[] = [
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'notesSlide', target: `../notesSlides/notesSlide${n}.xml` },
    ];
    const linkOf = (target: string, kind: string) => {
      const id = `rId${String(slideRels.length + 1)}`;
      slideRels.push({ id, type: kind, target, external: true });
      return id;
    };
    const relOf = (key: MediaKey, kind: string) => {
      const target = `../media/${partFor(key)}`;
      const type = kind === 'media' ? REL_MEDIA : kind;
      const found = slideRels.find((r) => r.target === target && r.type === type);
      if (found) return found.id;
      const id = `rId${String(slideRels.length + 1)}`;
      slideRels.push({ id, type, target });
      return id;
    };
    const tree = slide.shapes.map((s) => shapeXml(s, relOf, linkOf)).join('');
    const transition = transitionXml(slide.transition, relOf);
    const timing = timingXml(slide);
    const xml = `${XML}<p:sld ${NS}${slide.hidden ? ' show="0"' : ''}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${slide.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition}${timing}</p:sld>`;
    files.push(
      { name: `ppt/slides/slide${n}.xml`, data: xml, deflate: true },
      { name: `ppt/slides/_rels/slide${n}.xml.rels`, data: rels(slideRels), deflate: true },
      { name: `ppt/notesSlides/notesSlide${n}.xml`, data: notesXml(slide.notes), deflate: true },
      {
        name: `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
        data: rels([
          { id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' },
          { id: 'rId2', type: 'slide', target: `../slides/slide${n}.xml` },
        ]),
        deflate: true,
      },
    );
  });
  const n = slides.map((_, i) => String(i + 1));
  const types: Record<string, string> = {
    png: 'image/png',
    mp4: 'video/mp4',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
  };
  const exts = new Set([...mediaPart.values()].map((m) => m.split('.').pop() ?? ''));
  const head = [
    {
      name: '[Content_Types].xml',
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[
        ...exts,
      ]
        .map((e) => `<Default Extension="${e}" ContentType="${types[e] ?? 'application/octet-stream'}"/>`)
        .join(
          '',
        )}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${n
        .map(
          (i) =>
            `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
        )
        .join('')}</Types>`,
      deflate: true,
    },
    {
      name: '_rels/.rels',
      data: rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }]),
      deflate: true,
    },
    {
      name: 'ppt/presentation.xml',
      data: `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${n.map((i) => `<p:sldId id="${String(255 + Number(i))}" r:id="rId${String(9 + Number(i))}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${String(DECK_WIDTH)}" cy="${String(DECK_HEIGHT)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      deflate: true,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: rels([
        { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
        { id: 'rId2', type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' },
        { id: 'rId3', type: 'theme', target: 'theme/theme1.xml' },
        ...n.map((i) => ({
          id: `rId${String(9 + Number(i))}`,
          type: 'slide',
          target: `slides/slide${i}.xml`,
        })),
      ]),
      deflate: true,
    },
    { name: 'ppt/theme/theme1.xml', data: THEME, deflate: true },
    { name: 'ppt/theme/theme2.xml', data: THEME, deflate: true },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER, deflate: true },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: rels([
        { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
        { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
      ]),
      deflate: true,
    },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT, deflate: true },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]),
      deflate: true,
    },
    { name: 'ppt/notesMasters/notesMaster1.xml', data: NOTES_MASTER, deflate: true },
    {
      name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      data: rels([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]),
      deflate: true,
    },
  ];
  return makeZip([...head, ...files]);
}
