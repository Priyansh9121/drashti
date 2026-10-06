import { pathToFileURL } from 'node:url';
import descriptorJson from '../formats/pp7-descriptor.json';
import type { Descriptor, UnknownField } from '../protobuf';
import { encodeMessage } from './protobuf-writer';

/*
 * For tests only: builds files in the shape of ProPresenter 7 documents
 * (Protocol Buffers, with the vendored definitions' field numbers), filled
 * with placeholder text written for these tests. Never imported by the app.
 */

const d = descriptorJson as Descriptor;
const id = (s: string) => ({ string: s });
const fileUrl = (path: string) => ({ absolute_string: pathToFileURL(path).href, platform: 1 });
const rgba = ([r, g, b, a = 1]: number[]) => ({ red: r, green: g, blue: b, alpha: a });
const bounds = ([x = 0, y = 0, width = 0, height = 0]: number[]) => ({
  origin: { x, y },
  size: { width, height },
});
const rtfBytes = (rtf: string) => Buffer.from(rtf, 'latin1');

/** A Graphics.Shadow: degrees (the mathematical way), points, opacity. */
export interface Pp7Shadow {
  angle: number;
  offset: number;
  radius: number;
  opacity?: number;
  color?: number[];
}
/** A Graphics.Stroke (style 0 is a solid line). */
export interface Pp7Stroke {
  width: number;
  color: number[];
  style?: number;
}
/** A Graphics.Path.Shape type (1 rectangle, 2 ellipse, 4 right triangle, 8 custom, 11 rounded), and points for custom paths. */
export interface Pp7Path {
  type: number;
  roundness?: number;
  points?: [number, number][];
  closed?: boolean;
}

export interface Pp7SlideSpec {
  id: string;
  label?: string;
  enabled?: boolean;
  text?: {
    rtf: string;
    rect?: number[];
    fill?: number[];
    vertical?: 0 | 1 | 2;
    rotation?: number;
    shadow?: Pp7Shadow;
    /** The element's own shadow (behind the box). */
    elementShadow?: Pp7Shadow;
    stroke?: Pp7Stroke;
    /** Graphics.Text.ScaleBehavior (2 shrinks the words to fit). */
    scale?: number;
    path?: Pp7Path;
  }[];
  shapes?: {
    rect: number[];
    path: Pp7Path;
    fill?: number[];
    stroke?: Pp7Stroke;
    rotation?: number;
    shadow?: boolean;
    gradient?: boolean;
  }[];
  image?: { path: string; rect: number[] };
  /** The slide's own transition: seconds, and the effect's name. */
  transition?: { seconds: number; effect?: string };
  /** How the cue moves on by itself: target 1 is the next slide, 4 the first; action 3 is after a time. */
  completion?: { target: number; action: number; seconds: number };
  background?: {
    path: string;
    kind: 'image' | 'video';
    loop?: boolean;
    /** A video's in and out points (seconds) and its markers, as the transport and the cue keep them. */
    points?: { in?: number; out?: number; markers?: { name: string; time: number }[] };
  };
  audio?: string | { path: string; volume?: number; loop?: boolean };
  /** A Clear cue (clears a layer), which Drashti does not run yet. */
  clear?: boolean;
  notesRtf?: string;
}

const shadowOf = (sh: Pp7Shadow) => ({
  enable: true,
  angle: sh.angle,
  offset: sh.offset,
  radius: sh.radius,
  opacity: sh.opacity ?? 1,
  color: rgba(sh.color ?? [0, 0, 0, 1]),
});
const strokeOf = (st: Pp7Stroke) => ({
  enable: true,
  width: st.width,
  color: rgba(st.color),
  style: st.style ?? 0,
});
const pathOf = (p: Pp7Path) => ({
  closed: p.closed ?? true,
  points: (
    p.points ?? [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
  ).map(([x, y]) => ({ point: { x, y } })),
  shape: {
    type: p.type,
    ...(p.roundness === undefined ? {} : { rounded_rectangle: { roundness: p.roundness } }),
  },
});

function elements(s: Pp7SlideSpec) {
  const out: Record<string, unknown>[] = [];
  s.text?.forEach((t, i) => {
    out.push({
      element: {
        uuid: id(`${s.id}-t${i}`),
        name: `Text ${i}`,
        bounds: bounds(t.rect ?? [100, 100, 1720, 880]),
        opacity: 1,
        ...(t.rotation === undefined ? {} : { rotation: t.rotation }),
        path: pathOf(t.path ?? { type: 1 }),
        text: {
          rtf_data: rtfBytes(t.rtf),
          vertical_alignment: t.vertical ?? 1,
          ...(t.shadow ? { shadow: shadowOf(t.shadow) } : {}),
          ...(t.scale === undefined ? {} : { scale_behavior: t.scale }),
        },
        ...(t.fill ? { fill: { enable: true, color: rgba(t.fill) } } : {}),
        ...(t.stroke ? { stroke: strokeOf(t.stroke) } : {}),
        ...(t.elementShadow ? { shadow: shadowOf(t.elementShadow) } : {}),
      },
    });
  });
  s.shapes?.forEach((sh, i) => {
    out.push({
      element: {
        uuid: id(`${s.id}-sh${i}`),
        name: `Shape ${i}`,
        bounds: bounds(sh.rect),
        opacity: 1,
        ...(sh.rotation === undefined ? {} : { rotation: sh.rotation }),
        path: pathOf(sh.path),
        ...(sh.fill || sh.gradient
          ? {
              fill: {
                enable: true,
                ...(sh.gradient
                  ? { gradient: { type: 0, stops: [{ color: rgba([1, 0, 0, 1]), position: 0 }] } }
                  : { color: rgba(sh.fill ?? [1, 1, 1, 1]) }),
              },
            }
          : {}),
        ...(sh.stroke ? { stroke: strokeOf(sh.stroke) } : {}),
        ...(sh.shadow ? { shadow: shadowOf({ angle: 315, offset: 5, radius: 5 }) } : {}),
      },
    });
  });
  if (s.image) {
    out.push({
      element: {
        uuid: id(`${s.id}-img`),
        bounds: bounds(s.image.rect),
        opacity: 1,
        fill: {
          enable: true,
          media: { url: fileUrl(s.image.path), image: { drawing: { scale_behavior: 0 } } },
        },
      },
    });
  }
  return out;
}

function actions(s: Pp7SlideSpec, width: number, height: number) {
  const list: Record<string, unknown>[] = [
    {
      uuid: id(`${s.id}-slide`),
      type: 11,
      slide: {
        presentation: {
          base_slide: { uuid: id(`${s.id}-base`), size: { width, height }, elements: elements(s) },
          ...(s.notesRtf ? { notes: { rtf_data: rtfBytes(s.notesRtf) } } : {}),
          ...(s.transition ? { transition: transitionOf(s.transition) } : {}),
        },
      },
    },
  ];
  if (s.background) {
    const points = s.background.points;
    const props = {
      drawing: { scale_behavior: 1 },
      ...(points && (points.in !== undefined || points.out !== undefined)
        ? { transport: { in_point: points.in ?? 0, out_point: points.out ?? 0 } }
        : {}),
    };
    list.push({
      uuid: id(`${s.id}-bg`),
      name: 'Background',
      type: 2,
      media: {
        layer_type: 0,
        element: { url: fileUrl(s.background.path), [s.background.kind]: props },
        ...(s.background.kind === 'video'
          ? { video: { playback_behavior: s.background.loop ? 1 : 0 } }
          : { image: {} }),
        ...(points?.markers ? { markers: points.markers } : {}),
      },
    });
  }
  if (s.clear) list.push({ uuid: id(`${s.id}-clear`), name: 'Clear', clear: { target_layer: 0 } });
  if (s.audio) {
    const audio = typeof s.audio === 'string' ? { path: s.audio } : s.audio;
    list.push({
      uuid: id(`${s.id}-audio`),
      name: 'Placeholder audio',
      type: 2,
      media: {
        layer_type: 1,
        element: {
          url: fileUrl(audio.path),
          audio: audio.volume === undefined ? {} : { audio: { volume: audio.volume } },
        },
        audio: audio.loop ? { playback_behavior: 1 } : {},
      },
    });
  }
  return list;
}

const transitionOf = (t: { seconds: number; effect?: string }) => ({
  duration: t.seconds,
  ...(t.effect ? { effect: { name: t.effect, render_id: t.effect } } : {}),
});

export interface Pp7DocSpec {
  uuid: string;
  /** The presentation's own default transition. */
  transition?: { seconds: number; effect?: string };
  name?: string;
  width?: number;
  height?: number;
  groups: { name: string; uuid: string; color?: number[]; slides: Pp7SlideSpec[] }[];
  /** Slides no group names. */
  loose?: Pp7SlideSpec[];
  arrangements?: { name: string; groups: string[] }[];
  /** The arrangement it is set to play in (an index into `arrangements`). */
  selectedArrangement?: number;
  ccliTitle?: string;
  ccliAuthor?: string;
  ccliArtist?: string;
  /** Leave out isEnabled everywhere (as a version without the field would). */
  noEnabledFlags?: boolean;
  unknown?: UnknownField[];
}

export function pp7Presentation(spec: Pp7DocSpec): Uint8Array {
  const width = spec.width ?? 1920;
  const height = spec.height ?? 1080;
  const all = [...spec.groups.flatMap((g) => g.slides), ...(spec.loose ?? [])];
  return encodeMessage(
    {
      uuid: id(spec.uuid),
      name: spec.name,
      cue_groups: spec.groups.map((g) => ({
        group: { uuid: id(g.uuid), name: g.name, color: rgba(g.color ?? [0, 0, 1, 1]) },
        cue_identifiers: g.slides.map((s) => id(s.id)),
      })),
      cues: all.map((s) => ({
        uuid: id(s.id),
        name: s.label ?? '',
        ...(spec.noEnabledFlags ? {} : { isEnabled: s.enabled ?? true }),
        ...(s.completion
          ? {
              completion_target_type: s.completion.target,
              completion_action_type: s.completion.action,
              completion_time: s.completion.seconds,
            }
          : {}),
        actions: actions(s, width, height),
      })),
      ...(spec.transition ? { transition: transitionOf(spec.transition) } : {}),
      arrangements: (spec.arrangements ?? []).map((a, i) => ({
        uuid: id(`arr-${i}`),
        name: a.name,
        group_identifiers: a.groups.map(id),
      })),
      ...(spec.selectedArrangement === undefined
        ? {}
        : { selected_arrangement: id(`arr-${spec.selectedArrangement}`) }),
      ...(spec.ccliTitle || spec.ccliAuthor || spec.ccliArtist
        ? {
            ccli: {
              ...(spec.ccliTitle ? { song_title: spec.ccliTitle } : {}),
              ...(spec.ccliAuthor ? { author: spec.ccliAuthor } : {}),
              ...(spec.ccliArtist ? { artist_credits: spec.ccliArtist } : {}),
            },
          }
        : {}),
      ...(spec.unknown ? { $unknown: spec.unknown } : {}),
    },
    'rv.data.Presentation',
    d,
  );
}

export function pp7Theme(slides: { name: string; rtf: string }[]): Uint8Array {
  return encodeMessage(
    {
      slides: slides.map((s, i) => ({
        name: s.name,
        base_slide: {
          uuid: id(`theme-${i}`),
          size: { width: 1920, height: 1080 },
          elements: elements({ id: `theme-${i}`, text: [{ rtf: s.rtf }] }),
        },
      })),
    },
    'rv.data.Template.Document',
    d,
  );
}

/** A Configuration/Props file: each prop is a cue showing one prop slide. */
export function pp7Props(props: { id: string; name: string; slide: Pp7SlideSpec }[]): Uint8Array {
  return encodeMessage(
    {
      cues: props.map((p) => ({
        uuid: id(p.id),
        name: p.name,
        actions: [
          {
            uuid: id(`${p.id}-action`),
            type: 11,
            slide: {
              prop: {
                base_slide: {
                  uuid: id(`${p.id}-slide`),
                  size: { width: 1920, height: 1080 },
                  elements: elements(p.slide),
                },
              },
            },
          },
        ],
      })),
    },
    'rv.data.PropDocument',
    d,
  );
}

export type Pp7PlaylistEntry =
  | { header: string }
  /** arrangement: which of the presentation's arrangements the item plays (an index). */
  | { presentation: string; name: string; arrangement?: number }
  | { media: string; name: string };

export function pp7Playlists(
  folders: { name: string; playlists: { name: string; entries: Pp7PlaylistEntry[] }[] }[],
  type = 1,
): Uint8Array {
  const item = (e: Pp7PlaylistEntry, i: number) => {
    if ('header' in e) return { uuid: id(`h-${i}`), name: e.header, header: { color: rgba([1, 0.5, 0, 1]) } };
    if ('presentation' in e)
      return {
        uuid: id(`p-${i}`),
        name: e.name,
        presentation: {
          document_path: fileUrl(e.presentation),
          ...(e.arrangement === undefined ? {} : { arrangement: id(`arr-${e.arrangement}`) }),
        },
      };
    return {
      uuid: id(`m-${i}`),
      name: e.name,
      cue: {
        uuid: id(`mc-${i}`),
        actions: [{ type: 2, media: { element: { url: fileUrl(e.media), video: {} }, video: {} } }],
      },
    };
  };
  return encodeMessage(
    {
      type,
      root_node: {
        uuid: id('root'),
        name: 'root',
        type: 4,
        playlists: {
          playlists: folders.map((f, fi) => ({
            uuid: id(`f-${fi}`),
            name: f.name,
            type: 2,
            playlists: {
              playlists: f.playlists.map((p, pi) => ({
                uuid: id(`pl-${fi}-${pi}`),
                name: p.name,
                type: 1,
                items: { items: p.entries.map(item) },
              })),
            },
          })),
        },
      },
    },
    'rv.data.PlaylistDocument',
    d,
  );
}
