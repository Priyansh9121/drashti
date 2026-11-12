import { describe, expect, it } from 'vitest';
import { parseXml } from '../xml';
import { readDeckSlide, stepsOf } from './pptx-deck';

function parallel(id: number, condition: string, children: string, attributes = ''): string {
  return `<p:par><p:cTn id="${id}"${attributes ? ` ${attributes}` : ''}><p:stCondLst>${condition}</p:stCondLst><p:childTnLst>${children}</p:childTnLst></p:cTn></p:par>`;
}

const delay = (ms: number | 'indefinite') => `<p:cond delay="${ms}"/>`;
const onEnd = (id: number, ms: number) => `<p:cond evt="onEnd" delay="${ms}"><p:tn val="${id}"/></p:cond>`;

function behaviour(
  name: string,
  shapeId: number,
  durationMs: number,
  attributes = '',
  textTarget = '',
): string {
  return `<p:${name}${attributes ? ` ${attributes}` : ''}><p:cBhvr><p:cTn id="${shapeId + 100}" dur="${durationMs}"/><p:tgtEl><p:spTgt spid="${shapeId}">${textTarget}</p:spTgt></p:tgtEl></p:cBhvr></p:${name}>`;
}

function read(groups: string): ReturnType<typeof readDeckSlide> {
  const slide = parseXml(
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld><p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${groups}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`,
  );
  return readDeckSlide(slide, new Map(), { cx: 12_192_000, cy: 6_858_000 });
}

describe('PowerPoint slide animation timing', () => {
  it('starts With Previous siblings at their own delays, then starts the next After Previous group', () => {
    const fade = (
      id: number,
      shape: number,
      start: number,
      type: 'clickEffect' | 'withEffect' | 'afterEffect',
    ) =>
      parallel(
        id,
        delay(start),
        behaviour('animEffect', shape, 200, 'filter="fade" transition="in"'),
        `nodeType="${type}" presetClass="entr" presetID="10"`,
      );
    // Office puts effects that start together in one inner par. Each delay is relative to that par.
    const delayed = parallel(
      10,
      delay('indefinite'),
      parallel(11, delay(0), fade(12, 2, 500, 'clickEffect') + fade(13, 3, 0, 'withEffect')),
    );
    const staggered = parallel(
      20,
      delay('indefinite'),
      parallel(
        21,
        delay(0),
        fade(22, 4, 0, 'clickEffect') +
          fade(23, 5, 200, 'withEffect') +
          fade(24, 6, 400, 'withEffect') +
          fade(25, 7, 600, 'withEffect'),
      ) + parallel(26, delay(800), fade(27, 8, 100, 'afterEffect') + fade(28, 9, 0, 'withEffect')),
    );
    const slide = read(delayed + staggered);
    expect(slide.groups.map((group) => group.lengthMs)).toEqual([700, 1100]);
    expect(slide.motion?.approximate).toBe(false);
    expect(slide.motion?.effects.map(({ shapeId, step, delayMs }) => [shapeId, step, delayMs])).toEqual([
      ['3', 1, 0],
      ['2', 1, 500],
      ['4', 2, 0],
      ['5', 2, 200],
      ['6', 2, 400],
      ['7', 2, 600],
      ['9', 2, 800],
      ['8', 2, 900],
    ]);
  });

  it('reads the gallery Zoom, Float, Split and symmetric Grow/Shrink with their durations', () => {
    const click = (id: number, preset: string, cls: 'entr' | 'exit' | 'emph', children: string) =>
      parallel(
        id,
        delay('indefinite'),
        parallel(
          id + 1,
          delay(0),
          parallel(
            id + 2,
            delay(0),
            children,
            `nodeType="clickEffect" presetClass="${cls}" presetID="${preset}"`,
          ),
        ),
      );
    const withFade = (shape: number, durationMs: number, direction: 'in' | 'out') =>
      behaviour('animEffect', shape, durationMs, `filter="fade" transition="${direction}"`).replace(
        `id="${shape + 100}"`,
        `id="${shape + 200}"`,
      );
    const float = (shape: number, direction: 'in' | 'out') => {
      const [from, to] = direction === 'in' ? ['#ppt_y+0.08', '#ppt_y'] : ['#ppt_y', '#ppt_y-0.08'];
      return (
        behaviour('anim', shape, 450)
          .replace('</p:cBhvr>', '<p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr>')
          .replace(
            '</p:anim>',
            `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`,
          ) + withFade(shape, 450, direction)
      );
    };
    const zoom = behaviour('animScale', 2, 300) + withFade(2, 300, 'in');
    const split = behaviour('animEffect', 5, 500, 'filter="barn(outVertical)" transition="in"');
    const grow = behaviour('animScale', 6, 600).replace(
      '</p:animScale>',
      '<p:by x="150000" y="150000"/></p:animScale>',
    );
    const slide = read(
      click(10, '53', 'entr', zoom) +
        click(20, '42', 'entr', float(3, 'in')) +
        click(30, '47', 'exit', float(4, 'out')) +
        click(40, '16', 'entr', split) +
        click(50, '6', 'emph', grow),
    );
    expect(slide.motion).toMatchObject({
      approximate: false,
      effects: [
        { shapeId: '2', step: 1, phase: 'in', kind: 'zoom', fade: true, durationMs: 300 },
        {
          shapeId: '3',
          step: 2,
          phase: 'in',
          kind: 'float',
          direction: 'up',
          distance: 0.08,
          durationMs: 450,
        },
        {
          shapeId: '4',
          step: 3,
          phase: 'out',
          kind: 'float',
          direction: 'up',
          distance: 0.08,
          durationMs: 450,
        },
        { shapeId: '5', step: 4, phase: 'in', kind: 'split', splitAxis: 'x', durationMs: 500 },
        { shapeId: '6', step: 5, phase: 'emphasis', kind: 'grow-shrink', scale: 1.5, durationMs: 600 },
      ],
    });
  });

  it('keeps the click, whole shape, parallel delays, and previous end for each effect', () => {
    const automatic = parallel(
      10,
      '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>',
      parallel(
        11,
        delay(120),
        behaviour('animEffect', 2, 350, 'filter="fade" transition="in"'),
        'nodeType="withEffect" presetClass="entr" presetID="10"',
      ),
    );
    const first = parallel(
      20,
      delay('indefinite'),
      parallel(
        21,
        delay(0),
        parallel(
          22,
          delay(0),
          behaviour('set', 3, 1),
          'nodeType="clickEffect" presetClass="entr" presetID="1"',
        ) +
          parallel(
            23,
            delay(80),
            behaviour('anim', 4, 400),
            'nodeType="withEffect" presetClass="entr" presetID="2" presetSubtype="4"',
          ),
      ) +
        parallel(
          24,
          onEnd(23, 120),
          parallel(
            25,
            delay(0),
            behaviour('animEffect', 5, 300, 'filter="wipe(left)" transition="in"'),
            'nodeType="afterEffect" presetClass="entr" presetID="22"',
          ) +
            parallel(
              26,
              delay(200),
              behaviour('animScale', 6, 150),
              'nodeType="withEffect" presetClass="entr" presetID="23"',
            ),
        ),
    );
    const second = parallel(
      30,
      delay('indefinite'),
      parallel(
        31,
        delay(45),
        behaviour('animRot', 6, 240, 'by="10800000"'),
        'nodeType="clickEffect" presetClass="emph" presetID="8"',
      ) +
        parallel(
          32,
          onEnd(106, 50),
          behaviour('animEffect', 2, 300, 'filter="fade" transition="out"'),
          'nodeType="afterEffect" presetClass="exit" presetID="10"',
        ),
    );
    const slide = read(automatic + first + second);
    expect(stepsOf(slide.groups)).toBe(3);
    expect(slide).toMatchObject({
      motion: {
        approximate: false,
        effects: [
          { shapeId: '2', step: 0, phase: 'in', kind: 'fade', delayMs: 120, durationMs: 350 },
          { shapeId: '3', step: 1, phase: 'in', kind: 'appear', delayMs: 0, durationMs: 0 },
          { shapeId: '4', step: 1, phase: 'in', kind: 'fly', direction: 'up', delayMs: 80, durationMs: 400 },
          {
            shapeId: '5',
            step: 1,
            phase: 'in',
            kind: 'wipe',
            direction: 'left',
            delayMs: 600,
            durationMs: 300,
          },
          { shapeId: '6', step: 1, phase: 'in', kind: 'zoom', delayMs: 800, durationMs: 150 },
          {
            shapeId: '6',
            step: 2,
            phase: 'emphasis',
            kind: 'spin',
            degrees: 180,
            delayMs: 45,
            durationMs: 240,
          },
          { shapeId: '2', step: 2, phase: 'out', kind: 'fade', delayMs: 335, durationMs: 300 },
        ],
      },
    });
  });

  it('reveals the whole text box at its first paragraph entrance and hides it at its last paragraph exit', () => {
    const click = (id: number, phase: 'in' | 'out', index: number) =>
      parallel(
        id,
        delay('indefinite'),
        parallel(
          id + 1,
          delay(0),
          parallel(
            id + 2,
            delay(0),
            behaviour(
              'animEffect',
              3,
              250,
              `filter="fade" transition="${phase}"`,
              `<p:txEl><p:pRg st="${index}" end="${index}"/></p:txEl>`,
            ).replace('id="103"', `id="${id + 3}"`),
            `nodeType="clickEffect" presetClass="${phase === 'in' ? 'entr' : 'exit'}" presetID="10"`,
          ),
        ),
      );
    const slide = read(click(10, 'in', 0) + click(20, 'in', 1) + click(30, 'out', 0) + click(40, 'out', 1));
    expect(stepsOf(slide.groups)).toBe(5);
    expect(slide.motion).toMatchObject({
      approximate: true,
      effects: [
        { shapeId: '3', step: 1, phase: 'in', kind: 'fade', durationMs: 250 },
        { shapeId: '3', step: 2, phase: 'emphasis', kind: 'pulse', durationMs: 250 },
        { shapeId: '3', step: 3, phase: 'emphasis', kind: 'pulse', durationMs: 250 },
        { shapeId: '3', step: 4, phase: 'out', kind: 'fade', durationMs: 250 },
      ],
    });
  });

  it('flags unsupported effects for a baked slide and preserves a whole-shape fallback at its click', () => {
    const first = parallel(
      20,
      delay('indefinite'),
      parallel(
        21,
        delay(35),
        behaviour('animMotion', 2, 650, 'path="M 0 0 L 1 1 E"'),
        'nodeType="clickEffect" presetClass="path" presetID="0"',
      ),
    );
    const second = parallel(
      30,
      delay('indefinite'),
      parallel(
        31,
        delay(0),
        behaviour(
          'animEffect',
          3,
          250,
          'filter="fade" transition="in"',
          '<p:txEl><p:pRg st="0" end="0"/></p:txEl>',
        ),
        'nodeType="clickEffect" presetClass="entr" presetID="10"',
      ) +
        parallel(
          32,
          delay(50),
          behaviour('animEffect', 4, 430, 'filter="checkerboard(across)" transition="in"'),
          'nodeType="withEffect" presetClass="entr" presetID="5"',
        ),
    );
    const slide = read(first + second);
    expect(stepsOf(slide.groups)).toBe(3);
    expect(slide).toMatchObject({
      motion: {
        approximate: true,
        effects: [
          { shapeId: '2', step: 1, phase: 'emphasis', kind: 'pulse', delayMs: 35, durationMs: 650 },
          { shapeId: '3', step: 2, phase: 'in', kind: 'fade', delayMs: 0, durationMs: 250 },
          { shapeId: '4', step: 2, phase: 'in', kind: 'fade', delayMs: 50, durationMs: 430 },
        ],
      },
    });
  });
});
