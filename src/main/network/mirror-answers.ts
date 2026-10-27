import type { EngineCommand } from '../../shared/engine/commands';
import type { PropItem } from '../../shared/engine/state';
import type { LowerThird } from '../../shared/lower-thirds';
import { idSchema } from '../../shared/model-schema';
import type { DeviceAnswer } from '../../shared/network-api';
import {
  mediaMatching,
  REMOTE_MEDIA_MAX,
  REMOTE_MEDIA_PAGE,
  type RemoteKeys,
  type RemoteMedia,
  type RemoteMediaPage,
  type RemoteMusic,
  type RemoteProp,
} from '../../shared/network-mirror';
import { cutText } from '../../shared/text';

/*
 * What the main process answers a Remote that mirrors the operator window (Session 54, D5): the library's props,
 * media, lower thirds and audio playlists read as the window reads them, and one put up by its id as the window
 * would put it up, read here from the library: a phone never sends what goes up. Each request has passed the
 * device's kind and Simple Mode's lock (network-service.ts) before it comes here.
 */

/** The mirror's reads of the library and this computer. */
export interface MirrorReads {
  /** The library's props, in the window's order, the one marked as the logo said. */
  props(): RemoteProp[];
  /** A prop ready for the engine, by its id; null when there is none. */
  prop(id: string): PropItem | null;
  /** The library's pictures, videos and sounds by name, as Media lists them (never their files). */
  media(): RemoteMedia[];
  lowerThirds(): LowerThird[];
  /** The audio playlists, in the window's order. */
  music(): RemoteMusic[];
  /** How the operator window writes a key, and whether its single-letter keys are on. */
  keys(): RemoteKeys;
}

export type MirrorOp =
  'keys' | 'props' | 'prop.show' | 'media' | 'media.show' | 'lowerThirds' | 'lowerThird.show' | 'music';

const ok = (body: Record<string, unknown> = {}): DeviceAnswer => ({
  status: 200,
  body: { ok: true, ...body },
});
const deny = (status: number, message: string): DeviceAnswer => ({ status, body: { ok: false, message } });

/** A whole number from a query string, within bounds; `fallback` when there is none. */
function whole(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' && /^\d{1,9}$/u.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** An id the phone named, or null (not one at all: nothing has it). */
const named = (raw: unknown): string | null => {
  const id = idSchema.safeParse(raw);
  return id.success ? id.data : null;
};

/**
 * A picture, video or sound up as a playlist's item of it goes up (show-engine.ts showMedia): a picture or video as
 * the background, fitted inside, played once, with the slide taken off; a sound on the audio layer, over the rest.
 */
function mediaCommands(m: RemoteMedia): EngineCommand[] {
  if (m.kind === 'audio')
    return [{ type: 'playAudio', audio: { id: m.id, title: m.name, mediaId: m.id, volume: 1, loop: false } }];
  return [
    { type: 'clearLayer', layer: 'slide' },
    {
      type: 'setBackground',
      background: { kind: 'media', mediaId: m.id, media: m.kind, fit: 'fit', loop: false },
    },
  ];
}

export function mirrorAnswer(
  op: MirrorOp,
  args: Record<string, unknown>,
  reads: MirrorReads,
  run: (command: EngineCommand, did: string) => DeviceAnswer,
): DeviceAnswer {
  switch (op) {
    case 'keys':
      return ok({ keys: reads.keys() });
    case 'props':
      return ok({ props: reads.props() });
    case 'prop.show': {
      const id = named(args['propId']);
      const prop = id === null ? null : reads.prop(id);
      return prop
        ? run({ type: 'showProp', prop }, `showed the prop “${prop.name}”`)
        : deny(404, 'There is no such prop.');
    }
    case 'media': {
      const query = typeof args['query'] === 'string' ? cutText(args['query'].trim(), 200) : '';
      const found = mediaMatching(reads.media(), query);
      const offset = whole(args['offset'], 0, 0, 1_000_000);
      const limit = whole(args['limit'], REMOTE_MEDIA_PAGE, 1, REMOTE_MEDIA_MAX);
      const page: RemoteMediaPage = {
        media: found.slice(offset, offset + limit),
        offset,
        total: found.length,
        query,
      };
      return ok({ ...page });
    }
    case 'media.show': {
      const id = named(args['mediaId']);
      const m = id === null ? undefined : reads.media().find((x) => x.id === id);
      if (!m) return deny(404, 'There is no such media item.');
      if (m.missing) return deny(409, `“${m.name}” is missing: Drashti cannot find its file.`);
      if (m.unplayable !== null)
        return deny(
          409,
          `Drashti cannot play “${m.name}” as it is (${m.unplayable}): convert it in Drashti first.`,
        );
      let answer = deny(409, 'Drashti could not put that up.');
      for (const command of mediaCommands(m)) {
        answer = run(command, command.type === 'clearLayer' ? 'took the slide off' : `put up “${m.name}”`);
        if (answer.status !== 200) return answer;
      }
      return answer;
    }
    case 'lowerThirds':
      return ok({ lowerThirds: reads.lowerThirds().map((l) => ({ id: l.id, lines: l.lines })) });
    case 'lowerThird.show': {
      const id = named(args['lowerThirdId']);
      const lowerThird = id === null ? undefined : reads.lowerThirds().find((l) => l.id === id);
      return lowerThird
        ? run({ type: 'showLowerThird', lowerThird }, 'showed a lower third')
        : deny(404, 'There is no such lower third.');
    }
    case 'music':
      return ok({ playlists: reads.music() });
  }
}
