import type { NativePath, ShapeKind } from './model';

/** SVG commands are generated solely from validated finite native numbers. */
export function nativePathData(path: NativePath, width: number, height: number): string {
  return path.commands
    .map((command) => {
      switch (command.op) {
        case 'M':
        case 'L':
          return `${command.op}${command.x * width} ${command.y * height}`;
        case 'C':
          return `C${command.x1 * width} ${command.y1 * height} ${command.x2 * width} ${command.y2 * height} ${command.x * width} ${command.y * height}`;
        case 'Q':
          return `Q${command.x1 * width} ${command.y1 * height} ${command.x * width} ${command.y * height}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}

export const DEFAULT_DRAWING: NativePath = {
  commands: [
    { op: 'M', x: 0, y: 0 },
    { op: 'L', x: 0.5, y: 1 },
    { op: 'L', x: 1, y: 0 },
  ],
  fillRule: 'nonzero',
  lineCap: 'round',
  lineJoin: 'round',
};

/** Drashti's simple geometric symbols, authored here in a 100-unit square; no imported artwork. */
function pathOf(kind: ShapeKind): string | null {
  switch (kind) {
    case 'arrow':
      return 'M0 30 L60 30 L60 0 L100 50 L60 100 L60 70 L0 70 Z';
    case 'triangle':
      return 'M50 0 L100 100 L0 100 Z';
    case 'diamond':
      return 'M50 0 L100 50 L50 100 L0 50 Z';
    case 'star':
      return 'M50 0 L61 35 L98 35 L68 57 L80 94 L50 72 L20 94 L32 57 L2 35 L39 35 Z';
    case 'heart':
      return 'M50 96 C30 78 0 56 0 30 C0 0 35 -8 50 17 C65 -8 100 0 100 30 C100 56 70 78 50 96 Z';
    case 'check':
      return 'M0 52 L17 35 L40 58 L83 0 L100 14 L42 100 Z';
    default:
      return null;
  }
}

export function shapePath(kind: ShapeKind, width: number, height: number): string | null {
  let coordinate = 0;
  return (
    pathOf(kind)?.replace(/-?\d+(?:\.\d+)?/gu, (value) =>
      String((Number(value) * (coordinate++ % 2 === 0 ? width : height)) / 100),
    ) ?? null
  );
}
