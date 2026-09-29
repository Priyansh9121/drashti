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

export interface Pp7SlideSpec {
  id: string;
  label?: string;
  enabled?: boolean;
  text?: { rtf: string; rect?: number[]; fill?: number[]; vertical?: 0 | 1 | 2 }[];
  image?: { path: string; rect: number[] };
  background?: { path: string; kind: 'image' | 'video'; loop?: boolean };
  audio?: string | { path: string; volume?: number; loop?: boolean };
  /** A Clear cue (clears a layer), which Drashti does not run yet. */
  clear?: boolean;
  notesRtf?: string;
}

function elements(s: Pp7SlideSpec) {
  const out: Record<string, unknown>[] = [];
  s.text?.forEach((t, i) => {
    out.push({
      element: {
        uuid: id(`${s.id}-t${i}`),
        name: `Text ${i}`,
        bounds: bounds(t.rect ?? [100, 100, 1720, 880]),
        opacity: 1,
        text: { rtf_data: rtfBytes(t.rtf), vertical_alignment: t.vertical ?? 1 },
        ...(t.fill ? { fill: { enable: true, color: rgba(t.fill) } } : {}),
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
        },
      },
    },
  ];
  if (s.background) {
    const props = { drawing: { scale_behavior: 1 } };
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

export interface Pp7DocSpec {
  uuid: string;
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
        actions: actions(s, width, height),
      })),
      arrangements: (spec.arrangements ?? []).map((a, i) => ({
        uuid: id(`arr-${i}`),
        name: a.name,
        group_identifiers: a.groups.map(id),
      })),
      ...(spec.selectedArrangement === undefined
        ? {}
        : { selected_arrangement: id(`arr-${spec.selectedArrangement}`) }),
      ...(spec.ccliTitle ? { ccli: { song_title: spec.ccliTitle } } : {}),
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
