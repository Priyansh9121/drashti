/* Test helpers for the show engine. Not used by the app itself. */
import type { EngineMessage } from '../../shared/engine/protocol';
import type { EngineTransport } from '../../shared/engine/transport';
import type { RenderSlide, TextStyle } from '../../shared/model';
import { MemorySlideSource } from './slide-source';

export const defaultStyle: TextStyle = {
  fontFamily: null,
  fontSize: 72,
  fontWeight: 400,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.2,
  shadow: false,
};

export function textSlide(id: string, text: string): RenderSlide {
  return {
    id,
    width: 1920,
    height: 1080,
    background: '#000000',
    elements: [
      {
        id: `${id}-t`,
        kind: 'text',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
        text,
        lang: 'en',
        style: defaultStyle,
      },
    ],
  };
}

/** p1: three slides, p2: one slide, empty: no slides. */
export function makeSource(): MemorySlideSource {
  const source = new MemorySlideSource();
  source.set('p1', [textSlide('p1s1', 'One'), textSlide('p1s2', 'Two'), textSlide('p1s3', 'Three')]);
  source.set('p2', [textSlide('p2s1', 'Only')]);
  source.set('empty', []);
  return source;
}

/** Records every message, cloned the way IPC would clone it. */
export class RecordingTransport implements EngineTransport {
  readonly messages: EngineMessage[] = [];

  broadcast(message: EngineMessage): void {
    this.messages.push(structuredClone(message));
  }

  get last(): EngineMessage | undefined {
    return this.messages.at(-1);
  }
}

/** Freeze deeply so tests fail if anything mutates state in place. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
