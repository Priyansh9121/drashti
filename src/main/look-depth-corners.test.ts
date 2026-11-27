import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * Execute the e2e probe's actual page callback against fixed geometry, without launching a browser. The old corner
 * check missed pointer-events:none boxes and thin LIVE rows between its three samples. These fixtures also ensure
 * that clips, rounded boxes and the column's ring hide only what they really cover.
 */
const file = join(__dirname, '../../tests/e2e/look-depth.spec.ts');
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true);
const probe = source.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'overCorners',
);

type Styles = Record<string, string>;
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
const CLEAR = 'rgba(0, 0, 0, 0)';
const defaults: Styles = {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  position: 'static',
  zIndex: 'auto',
  transform: 'none',
  filter: 'none',
  isolation: 'auto',
  willChange: 'auto',
  mixBlendMode: 'normal',
  backgroundColor: CLEAR,
  backgroundImage: 'none',
  overflowX: 'visible',
  overflowY: 'visible',
  content: 'none',
};
for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
  defaults[`border${side}Width`] = '0px';
  defaults[`border${side}Color`] = CLEAR;
  defaults[`border${side}Style`] = 'none';
}
const rounded = (radius: string): Styles =>
  Object.fromEntries(
    ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map((corner) => [
      `border${corner}Radius`,
      radius,
    ]),
  );
Object.assign(defaults, rounded('0px'));

class ElementBox {
  readonly tagName = 'DIV';
  readonly children: ElementBox[] = [];
  readonly styles: Styles;
  readonly pseudos: Record<string, Styles> = {};
  parentElement: ElementBox | null = null;

  constructor(
    readonly id: string,
    readonly box: Box,
    styles: Styles = {},
  ) {
    this.styles = { ...defaults, ...styles };
  }

  append(child: ElementBox) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name: string) {
    return name === 'data-testid' ? this.id : null;
  }

  getBoundingClientRect() {
    return { ...this.box, right: this.box.left + this.box.width, bottom: this.box.top + this.box.height };
  }

  querySelectorAll() {
    return this.children.flatMap((child): ElementBox[] => [child, ...child.querySelectorAll()]);
  }
}

function column(ringZ = 100) {
  const col = new ElementBox(
    'column-right',
    { left: 0, top: 0, width: 100, height: 100 },
    { borderLeftWidth: '4px', borderRightWidth: '4px', overflowX: 'clip', overflowY: 'clip' },
  );
  col.pseudos['::after'] = { ...defaults, ...rounded('12px'), content: '""', zIndex: String(ringZ) };
  return col;
}

function overlaps(col: ElementBox): string[] {
  expect(probe, 'look-depth.spec.ts must contain its executable overCorners probe').toBeDefined();
  if (!probe) throw new Error('Missing overCorners probe');
  const code = ts.transpileModule(probe.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  const read = runInNewContext(`${code}\noverCorners`, {
    HTMLElement: ElementBox,
    document: {
      querySelector: (selector: string) =>
        selector === '[data-testid="column-right"]' ? col : null,
      // There is deliberately no pointer hit: this probe must inspect the boxes that actually paint.
      elementsFromPoint: () => [],
    },
    getComputedStyle: (el: ElementBox, pseudo?: string) => {
      const styles = pseudo ? (el.pseudos[pseudo] ?? defaults) : el.styles;
      return {
        ...styles,
        getPropertyValue: (name: string) =>
          styles[name.replace(/-([a-z])/gu, (_, c: string) => c.toUpperCase())] ?? '',
      };
    },
  }) as (page: { evaluate: (callback: () => string[]) => string[] }) => string[];
  return read({ evaluate: (callback) => callback() });
}

describe('Depth: the e2e corner probe sees what paints', () => {
  it.each([
    ['top left', 4, 0],
    ['top right', 84, 0],
    ['bottom left', 4, 88],
    ['bottom right', 84, 88],
  ] as const)('sees a pointer-free box at the %s corner', (_, left, top) => {
    const col = column();
    col.append(
      new ElementBox(
        'pointer-free',
        { left, top, width: 12, height: 12 },
        { pointerEvents: 'none', backgroundColor: 'rgb(40, 40, 40)', position: 'absolute', zIndex: '101' },
      ),
    );
    expect(overlaps(col)).toEqual([expect.stringContaining('pointer-free')]);
  });

  it('sees a rounded LIVE row in the last three pixels of the column when the ring is underneath', () => {
    const col = column(-1);
    col.append(
      new ElementBox(
        'thin-live-row',
        { left: 8, top: 97, width: 84, height: 20 },
        { ...rounded('8px'), backgroundColor: 'rgb(40, 40, 40)' },
      ),
    );
    expect(overlaps(col)).toEqual([expect.stringContaining('thin-live-row')]);
  });

  it('respects the row’s scrollport clip and a transparent ancestor', () => {
    const col = column(-1);
    const viewport = col.append(
      new ElementBox(
        'scrollport',
        { left: 8, top: 4, width: 84, height: 92 },
        { overflowX: 'hidden', overflowY: 'auto' },
      ),
    );
    viewport.append(
      new ElementBox(
        'clipped-row',
        { left: 8, top: 97, width: 84, height: 20 },
        { backgroundColor: 'rgb(40, 40, 40)' },
      ),
    );
    expect(overlaps(col)).toEqual([]);
    viewport.styles['overflowX'] = 'visible';
    viewport.styles['overflowY'] = 'visible';
    expect(overlaps(col)).toEqual([expect.stringContaining('clipped-row')]);
    viewport.styles['opacity'] = '0';
    expect(overlaps(col)).toEqual([]);
  });

  it('accepts a box rounded inside the column’s own arcs', () => {
    const col = column(-1);
    col.append(
      new ElementBox(
        'rounded-sheet',
        { left: 4, top: 0, width: 92, height: 100 },
        { ...rounded('12px'), backgroundColor: 'rgb(40, 40, 40)' },
      ),
    );
    expect(overlaps(col)).toEqual([]);
  });

  it('distinguishes the ring’s cover from a child that paints above it', () => {
    const col = column();
    const sheet = col.append(
      new ElementBox(
        'sheet',
        { left: 4, top: 0, width: 92, height: 100 },
        { backgroundColor: 'rgb(40, 40, 40)', position: 'absolute', zIndex: '99' },
      ),
    );
    expect(overlaps(col)).toEqual([]);
    sheet.styles['zIndex'] = '101';
    expect(overlaps(col)).toEqual([expect.stringContaining('sheet')]);
  });

  it('lets a high child escape a positioned auto parent, but not its own stacking context', () => {
    const col = column();
    const parent = col.append(
      new ElementBox('positioned-parent', col.box, { position: 'relative' }),
    );
    parent.append(
      new ElementBox(
        'high-child',
        { left: 4, top: 0, width: 12, height: 12 },
        { backgroundColor: 'rgb(40, 40, 40)', position: 'absolute', zIndex: '101' },
      ),
    );
    expect(overlaps(col)).toEqual([expect.stringContaining('high-child')]);
    parent.styles['isolation'] = 'isolate';
    expect(overlaps(col)).toEqual([]);
  });
});
