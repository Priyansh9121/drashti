import type { SabhaFlow, SabhaFlowLang } from './sabha-flow';

/* Red: the lines are not built yet. */

export interface FlowLine {
  index: number;
  no: string;
  parts: string[];
  video: boolean;
}

export interface NowNext {
  now: FlowLine | null;
  next: FlowLine | null;
  last: boolean;
}

export const flowLine = (_flow: SabhaFlow, _index: number, _length: 'short' | 'full'): FlowLine | null => null;
export const lineText = (_line: FlowLine): string => '';
export const cellHeader = (_flow: SabhaFlow, _cell: number): string | undefined => undefined;
export const nowNext = (_flow: SabhaFlow, _now: number | null): NowNext => ({ now: null, next: null, last: false });
export const nowText = (_nn: NowNext): string => '';
export const nextText = (_nn: NowNext): string => '';
export const isVideoText = (_text: string): boolean => false;
export const textLang = (_text: string, _lang: SabhaFlowLang): 'en' | 'gu' | 'hi' => 'en';
